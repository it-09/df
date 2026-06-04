import { Actor, log } from 'apify';

// Scrapers
import { scrapeReddit } from './scrapers/reddit.js';
import { scrapeGitHub } from './scrapers/github.js';
import { scrapeHackerNews } from './scrapers/hackernews.js';
import { scrapeNews } from './scrapers/news.js';
import { scrapeG2 } from './scrapers/g2.js';
import { scrapeLinkedIn } from './scrapers/linkedin.js';

// Classifiers
import { analyzeSentiment, analyzeAspectSentiment } from './classifiers/sentiment.js';
import { detectBuyingSignals, detectCompetitors, predictBuyingStage, detectNoise } from './classifiers/intent.js';
import { extractPersona, isDecisionMaker, scorePersonaInfluence } from './classifiers/persona.js';
import { detectPainSignals } from './classifiers/pain.js';
import { detectSwitchingSignals } from './classifiers/switching.js';
import { calculateIntentScore, calculateLeadPriority } from './classifiers/leadScorer.js';
import { calculateCommercialRelevance } from './classifiers/relevance.js';
import { evaluateSignalWithLLM } from './classifiers/llmEvaluator.js';
import { generateExplainability, generateOutreachAngle, calculateICPFit, generateCrmReady } from './classifiers/crm.js';
import { generateSmartAlert } from './classifiers/alerts.js';
import { enrichCompany } from './utils/enrichment.js';
import { loadMonitorState, saveMonitorState, generateSignalHash, calculateCompetitorRisk } from './utils/monitor.js';

// Utilities
import { deduplicateSignals, calculateConfidence, cleanText } from './utils/normalizer.js';
import { aggregateByCompany, generateExecutiveSummary, generateCompanyExecutiveSummary, identifyHighIntentSignals, generateSalesInsights } from './utils/aggregator.js';

await Actor.init();

const token = process.env.APIFY_TOKEN;
const datasetId = process.env.APIFY_DEFAULT_DATASET_ID;

async function pushDataToApify(items, typeLabel = 'data') {
    if (!token || !datasetId) {
        log.warning(`Missing APIFY_TOKEN or APIFY_DEFAULT_DATASET_ID. Skipping REST push for ${typeLabel}.`);
        return;
    }
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`;
    
    const dataArray = Array.isArray(items) ? items : [items];
    if (dataArray.length === 0) return;

    const CHUNK_SIZE = 5;
    const totalChunks = Math.ceil(dataArray.length / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
        const chunk = dataArray.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        console.log(`Persisting ${typeLabel} chunk ${i + 1}/${totalChunks}...`);
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(chunk)
            });
            console.log(`POST status: ${response.status}`);
            if (response.ok) {
                console.log(`✅ chunk persisted`);
            } else {
                console.error(`❌ chunk failed`, await response.text());
            }
        } catch (e) {
            console.error(`❌ fetch error for chunk`, e);
        }
    }
}

log.info('--- DATASET ROUTING FORENSIC AUDIT ---');
log.info('Default dataset env:', { id: datasetId });
log.info('Actor env dataset ID:', { id: Actor.getEnv().defaultDatasetId });

log.info('Dataset info:', {
    id: datasetId,
    isLocal: process.env.APIFY_IS_AT_HOME === '1' ? false : true
});

log.info('Pushing single tracking record via REST API...');
await pushDataToApify({ _type: 'routing_audit', timestamp: new Date().toISOString() }, 'routing_audit');
log.info('--------------------------------------------');

const input = (await Actor.getInput()) ?? {};

// --- H2: Support both old sources{} object AND new individual boolean toggles ---
let {
    companies = ['Notion', 'HubSpot'],
    templatePreset = 'custom',
    maxRequestsPerCrawl = 10,
    // New boolean toggles (preferred)
    enableReddit,
    enableGithub,
    enableHackernews,
    enableNews,
    enableG2,
    enableLinkedin,
    // Legacy sources object (backward compat)
    sources,
    newsApiKey = null,
    monitoringMode = 'off',
    competitorWatch = [],
    knownCompetitors = []
} = input;

// LLM API key is managed by the Actor owner via environment variable
const openaiApiKey = process.env.OPENAI_API_KEY || null;

// Apply Templates
if (templatePreset === 'crm_switching') {
    companies = ['HubSpot', 'Salesforce', 'Pipedrive'];
    log.info('Applying Template: CRM Competitor Switching');
} else if (templatePreset === 'payment_processor') {
    companies = ['Stripe', 'Adyen', 'PayPal'];
    log.info('Applying Template: Payment Processor Switching');
} else if (templatePreset === 'devops_hosting') {
    companies = ['Vercel', 'Netlify', 'Cloudflare'];
    log.info('Applying Template: DevOps / Hosting Migration');
} else if (templatePreset === 'marketing_agency') {
    companies = ['SEO agency', 'marketing agency'];
    log.info('Applying Template: Marketing Agency Dissatisfaction');
} else if (templatePreset !== 'custom') {
    log.warning(`Unknown template "${templatePreset}", using manual company input.`);
}

// Resolve source toggles: new booleans take priority, fall back to legacy object, then defaults
const resolvedSources = {
    reddit: enableReddit ?? sources?.reddit ?? true,
    github: enableGithub ?? sources?.github ?? true,
    hackernews: enableHackernews ?? sources?.hackernews ?? true,
    news: enableNews ?? sources?.news ?? false,
    g2: enableG2 ?? sources?.g2 ?? true,
    linkedin: enableLinkedin ?? sources?.linkedin ?? true,
};

// --- M2: Input validation ---
if (!companies || !Array.isArray(companies) || companies.length === 0) {
    throw new Error('Input error: "companies" must be a non-empty array of company names. Example: ["Notion", "Stripe"]');
}

if (companies.length > 50) {
    throw new Error(`Input error: Maximum 50 companies per run. You provided ${companies.length}.`);
}

const validCompanies = companies.filter(c => typeof c === 'string' && c.trim().length > 0).map(c => c.trim());
if (validCompanies.length === 0) {
    throw new Error('Input error: All company names are empty strings. Please provide valid company names.');
}

if (validCompanies.length < companies.length) {
    log.warning(`Filtered out ${companies.length - validCompanies.length} empty/invalid company names.`);
}

if (resolvedSources.news && !newsApiKey) {
    log.warning('News source is enabled but no API key provided. News scraping will be skipped. Get a free key at https://newsapi.org');
    resolvedSources.news = false;
}

const maxResults = Math.max(1, Math.min(100, maxRequestsPerCrawl));

log.info('Starting Dark Funnel Intelligence Engine', {
    companies: validCompanies,
    sources: resolvedSources,
    maxResultsPerCompany: maxResults,
});

await Actor.setStatusMessage(`Collecting signals from ${Object.values(resolvedSources).filter(Boolean).length} sources for ${validCompanies.length} companies...`);

// Collect signals from all enabled sources
let allSignals = [];

log.info('Fetching company enrichment profiles...');
const companyProfiles = {};
for (const company of validCompanies) {
    companyProfiles[company] = await enrichCompany(company);
}

// NEW WAVE 3: Load Monitoring State
const monitorState = await loadMonitorState();
const seenHashes = monitorState.seenHashes;
const previousStats = monitorState.previousStats;
if (monitoringMode !== 'off') {
    log.info(`Monitoring Mode ACTIVE (${monitoringMode.toUpperCase()}). Tracking deltas against previous run.`);
}

try {
    // 1. Scrape Reddit (using Apify actor chaining)
    if (resolvedSources.reddit) {
        try {
            log.info('Scraping Reddit...');
            const redditSignals = await scrapeReddit(validCompanies, maxResults);
            allSignals.push(...redditSignals);
            log.info(`Reddit: ${redditSignals.length} signals collected`);
        } catch (redditError) {
            log.warning('Reddit scraping failed, continuing with other sources', { error: redditError.message });
        }
    }

    // 2. Scrape GitHub
    if (resolvedSources.github) {
        log.info('Scraping GitHub...');
        const githubSignals = await scrapeGitHub(validCompanies, maxResults);
        allSignals.push(...githubSignals);
        log.info(`GitHub: ${githubSignals.length} signals collected`);
    }

    // 3. Scrape Hacker News
    if (resolvedSources.hackernews) {
        log.info('Scraping Hacker News...');
        const hnSignals = await scrapeHackerNews(validCompanies, maxResults);
        allSignals.push(...hnSignals);
        log.info(`Hacker News: ${hnSignals.length} signals collected`);
    }

    // 4. Scrape News (optional)
    if (resolvedSources.news && newsApiKey) {
        log.info('Scraping News...');
        const newsSignals = await scrapeNews(validCompanies, newsApiKey, maxResults);
        allSignals.push(...newsSignals);
        log.info(`News: ${newsSignals.length} signals collected`);
    }

    // 5. Scrape G2 Reviews
    if (resolvedSources.g2) {
        log.info('Scraping G2 Reviews...');
        const g2Signals = await scrapeG2(validCompanies, maxResults);
        allSignals.push(...g2Signals);
        log.info(`G2: ${g2Signals.length} signals collected`);
    }

    // 6. Scrape LinkedIn
    if (resolvedSources.linkedin) {
        log.info('Scraping LinkedIn...');
        const linkedInSignals = await scrapeLinkedIn(validCompanies, maxResults);
        allSignals.push(...linkedInSignals);
        log.info(`LinkedIn: ${linkedInSignals.length} signals collected`);
    }

    log.info(`Total raw signals collected: ${allSignals.length}`);
    await Actor.setStatusMessage(`Collected ${allSignals.length} raw signals. Running NLP analysis...`);

    // SOURCE FORENSICS
    const forensics = {
        RAW_SOURCE_COUNTS: {},
        POST_FILTER_COUNTS: {},
        LLM_ACCEPT_COUNTS: {},
        FINAL_PUSH_COUNTS: {}
    };
    allSignals.forEach(s => { forensics.RAW_SOURCE_COUNTS[s.source] = (forensics.RAW_SOURCE_COUNTS[s.source] || 0) + 1; });


    if (allSignals.length === 0) {
        log.warning('No signals found. Try different company names or enable more sources.');
        await pushDataToApify({
            _type: 'executive_summary',
            totalCompanies: validCompanies.length,
            totalSignals: 0,
            avgSignalsPerCompany: '0',
            sentimentBreakdown: { positive: 0, negative: 0, neutral: 0 },
            topCompanies: [],
            highPriorityAlerts: [],
            generatedAt: new Date().toISOString(),
        }, 'executive_summary');
        
        if (token && datasetId) {
            try {
                const infoResponse = await fetch(`https://api.apify.com/v2/datasets/${datasetId}?token=${token}`);
                if (infoResponse.ok) {
                    const infoData = await infoResponse.json();
                    console.log(`\nFinal dataset itemCount: ${infoData.data.itemCount}`);
                }
            } catch (e) {
                console.error('Failed to fetch final dataset metadata', e);
            }
        }
        await Actor.exit();
        process.exit(0);
    }

    // Deduplicate signals
    allSignals = deduplicateSignals(allSignals);
    log.info(`After deduplication: ${allSignals.length} signals`);

    // STAGE 1 & 2: Heuristic Filtering
    log.info('Running Stage 1 & 2 Heuristic Filtering...');
    const heuristicSignals = allSignals.map(signal => {
        const fullText = `${signal.title || ''} ${signal.content || ''}`;
        const cleanedText = cleanText(fullText);

        const signalDate = signal.createdAt ? new Date(signal.createdAt) : new Date();
        const daysOld = Math.max(0, Math.floor((new Date() - signalDate) / (1000 * 60 * 60 * 24)));
        const noiseData = detectNoise(cleanedText);

        const sentiment = analyzeAspectSentiment(cleanedText, signal.company, knownCompetitors);
        const buyingSignals = detectBuyingSignals(cleanedText);
        const competitorSignals = detectCompetitors(cleanedText, knownCompetitors);
        const personaSignals = extractPersona(cleanedText);
        const buyingStage = predictBuyingStage(buyingSignals, sentiment);
        const painSignals = detectPainSignals(cleanedText);
        const switchSignals = detectSwitchingSignals(cleanedText, validCompanies, knownCompetitors);

        const { commercialRelevanceScore, commercialRelevanceLevel } = calculateCommercialRelevance(
            cleanedText, signal.title, signal.author, { buyingSignals, painSignals, switchSignals, buyingStage }
        );

        const { intentScore, intentLevel } = calculateIntentScore({
            buyingSignals, sentiment, personaSignals, painSignals, switchSignals, buyingStage, competitorSignals
        }, signal.source, signal.subreddit, daysOld, noiseData.isNoise);

        let rejectionReason = '';
        const hasCommercialPainOrIntent = 
            buyingSignals.hasFrustrationSignal || 
            buyingSignals.hasEvaluationSignal || 
            switchSignals.switchingDetected || 
            buyingSignals.hasBudgetSignal || 
            buyingSignals.hasTechnicalSignal || 
            buyingSignals.hasDecisionSignal || 
            competitorSignals.hasCompetitiveSignal;

        if (noiseData.isNoise) {
            rejectionReason = noiseData.reason;
        } else if (!hasCommercialPainOrIntent) {
            rejectionReason = `Generic mention lacking commercial or pain indicators`;
        } else if (daysOld > 90 && !switchSignals.switchingDetected && !buyingSignals.hasFrustrationSignal && !buyingSignals.hasEvaluationSignal) {
            rejectionReason = `Content is too old (${daysOld} days) and lacks explicit switching/evaluation intent`;
        }

        let signalQuality = intentScore >= 60 ? 'HIGH' : (intentScore >= 30 ? 'MEDIUM' : 'LOW');
        if (rejectionReason) {
            signalQuality = 'REJECT';
        }

        const leadPriority = calculateLeadPriority({
            intentScore, painSignals, switchSignals, personaSignals, buyingSignals, competitorSignals, buyingStage, commercialRelevanceLevel
        });

        return {
            ...signal,
            rejectionReason,
            signalQuality,
            sentiment: { score: sentiment.overall.score, label: sentiment.overall.label, towardCompany: sentiment.towardCompany, towardCompetitors: sentiment.towardCompetitors },
            buyingSignals: { hasBudgetSignal: buyingSignals.hasBudgetSignal, hasTimelineSignal: buyingSignals.hasTimelineSignal, hasTechnicalSignal: buyingSignals.hasTechnicalSignal, hasEvaluationSignal: buyingSignals.hasEvaluationSignal, hasDecisionSignal: buyingSignals.hasDecisionSignal, confidence: buyingSignals.confidence, signals: buyingSignals.signals },
            competitorSignals: { hasCompetitiveSignal: competitorSignals.hasCompetitiveSignal, competitors: competitorSignals.competitors },
            personaSignals: { jobTitles: personaSignals.jobTitles, departments: personaSignals.departments, seniorityLevels: personaSignals.seniorityLevels, isDecisionMaker: isDecisionMaker(personaSignals), influenceScore: scorePersonaInfluence(personaSignals) },
            buyingStage,
            confidence: 1.0,
            painSignals: { hasPainSignal: painSignals.hasPainSignal, painTypes: painSignals.painTypes, severity: painSignals.severity, confidence: painSignals.confidence },
            switchSignals: { switchingDetected: switchSignals.switchingDetected, switchingFrom: switchSignals.switchingFrom, switchingTo: switchSignals.switchingTo, confidence: switchSignals.confidence, stage: switchSignals.stage },
            intentScore,
            intentLevel,
            leadPriority,
            commercialRelevanceScore,
            commercialRelevanceLevel
        };
    });

    // STAGE 3: LLM Truth Layer
    if (!openaiApiKey) {
        log.warning('------------------------------------------------------');
        log.warning('⚠️ LLM buyer qualification disabled (No OpenAI API Key).');
        log.warning('Results may contain false positives (listicles, spam).');
        log.warning('Add an API key to enable production CRM readiness.');
        log.warning('------------------------------------------------------');
    } else {
        log.info('Running Stage 3 LLM Truth Layer on top candidates...');
    }

    const enrichedSignals = [];
    const BATCH_SIZE = 10;
    
    // We only send candidates >= 40 to the LLM
    const candidates = heuristicSignals.filter(s => s.intentScore >= 40);
    const nonCandidates = heuristicSignals.filter(s => s.intentScore < 40);
    candidates.forEach(s => { forensics.POST_FILTER_COUNTS[s.source] = (forensics.POST_FILTER_COUNTS[s.source] || 0) + 1; });

    
    if (openaiApiKey && candidates.length > 0) {
        log.info(`Filtered down to ${candidates.length} candidates out of ${allSignals.length} raw signals.`);
        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
            const batch = candidates.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (signal) => {
                const llmResult = await evaluateSignalWithLLM(signal, openaiApiKey);
                
                // Override heuristic data if LLM evaluates successfully
                let finalScore = signal.intentScore;
                let leadPriority = signal.leadPriority;
                let whyHighIntent = '';
                
                if (llmResult.isGenuineBuyer) {
                    forensics.LLM_ACCEPT_COUNTS[signal.source] = (forensics.LLM_ACCEPT_COUNTS[signal.source] || 0) + 1;
                    finalScore = llmResult.intentScore;
                    if (finalScore >= 80) leadPriority = 'URGENT';
                    else if (finalScore >= 60) leadPriority = 'HIGH';
                    else leadPriority = 'MEDIUM';
                    whyHighIntent = llmResult.explanation;
                    signal.intentLevel = finalScore >= 80 ? 'HIGH' : finalScore >= 40 ? 'MEDIUM' : 'LOW';
                    
                    if (llmResult.painPoints.length > 0) {
                        signal.painSignals.hasPainSignal = true;
                        signal.painSignals.painTypes = llmResult.painPoints;
                    }
                    if (llmResult.switchingFrom || llmResult.switchingTo) {
                        signal.switchSignals.switchingDetected = true;
                        signal.switchSignals.switchingFrom = llmResult.switchingFrom;
                        signal.switchSignals.switchingTo = llmResult.switchingTo;
                    }
                    if (llmResult.personas.length > 0) {
                        signal.personaSignals.jobTitles = llmResult.personas;
                    }
                } else {
                    // LLM rejected it as noise
                    finalScore = 0;
                    leadPriority = 'LOW';
                    signal.commercialRelevanceLevel = 'LOW';
                    signal.commercialRelevanceScore = 0;
                    signal.intentLevel = 'LOW';
                    signal.buyingStage = 'awareness';
                    whyHighIntent = 'Rejected by LLM Truth Layer';
                }

                signal.intentScore = finalScore;
                signal.leadPriority = leadPriority;
                signal.whyHighIntent = whyHighIntent;
                return signal;
            }));
            
            enrichedSignals.push(...batchResults);
            log.info(`Evaluated ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length} candidates...`);
        }
    } else {
        // Fallback: just use heuristic candidates
        for (const signal of candidates) {
            // Revert back to the old explainability array generator for fallback
            const crmData = {
                intentScore: signal.intentScore, leadPriority: signal.leadPriority, commercialRelevanceLevel: signal.commercialRelevanceLevel, 
                switchSignals: signal.switchSignals, painSignals: signal.painSignals, personaSignals: signal.personaSignals, buyingStage: signal.buyingStage, buyingSignals: signal.buyingSignals, competitorSignals: signal.competitorSignals
            };
            signal.whyHighIntent = generateExplainability(crmData).join(' + ');
            enrichedSignals.push(signal);
        }
    }

    // Add back the non-candidates (they just stay LOW)
    for (const signal of nonCandidates) {
        signal.whyHighIntent = '';
        enrichedSignals.push(signal);
    }

    // Finalize all signals
    for (const signal of enrichedSignals) {
        const crmData = {
            intentScore: signal.intentScore, 
            leadPriority: signal.leadPriority, 
            commercialRelevanceLevel: signal.commercialRelevanceLevel, 
            switchSignals: signal.switchSignals, 
            painSignals: signal.painSignals, 
            personaSignals: signal.personaSignals, 
            buyingStage: signal.buyingStage, 
            buyingSignals: signal.buyingSignals, 
            competitorSignals: signal.competitorSignals
        };

        signal.recommendedOutreachAngle = generateOutreachAngle(crmData);
        signal.estimatedICPFit = calculateICPFit(crmData);
        signal.companyEnrichment = companyProfiles[signal.company] || {};
        signal.crmReady = generateCrmReady({ ...crmData, whyHighIntent: signal.whyHighIntent });

        const signalHash = generateSignalHash(signal);
        signal.isNew = !seenHashes.has(signalHash);
        if (monitoringMode !== 'off') {
            seenHashes.add(signalHash);
        }
    }

    // --- SOURCE QUALITY RECOVERY SPRINT: TASK 4 (Source Diversity Quotas) ---
    // 1. Sort signals intelligently
    const stageVal = { 'decision': 4, 'evaluation': 3, 'consideration': 2, 'awareness': 1, 'none': 0 };
    enrichedSignals.sort((a, b) => {
        // 1. Strongest intent score
        if (b.intentScore !== a.intentScore) return b.intentScore - a.intentScore;
        // 2. Switching signals
        const aSwitch = a.switchSignals?.switchingDetected ? 1 : 0;
        const bSwitch = b.switchSignals?.switchingDetected ? 1 : 0;
        if (bSwitch !== aSwitch) return bSwitch - aSwitch;
        // 3. Pricing pain
        const aPrice = a.painSignals?.painTypes?.includes('pricing') ? 1 : 0;
        const bPrice = b.painSignals?.painTypes?.includes('pricing') ? 1 : 0;
        if (bPrice !== aPrice) return bPrice - aPrice;
        // 4. Buying stage
        const aStage = stageVal[a.buyingStage] || 0;
        const bStage = stageVal[b.buyingStage] || 0;
        if (bStage !== aStage) return bStage - aStage;
        // 5. Freshness
        return (a.contentAgeDays || 0) - (b.contentAgeDays || 0);
    });

    // 2. Apply hard caps per source
    const sourceQuotas = { 'reddit': 5, 'linkedin': 5, 'g2': 4, 'hackernews': 3, 'github': 3 };
    const sourceCounts = {};
    const truncatedSignals = [];

    for (const signal of enrichedSignals) {
        if (signal.signalQuality === 'REJECT') continue; // Drop rejects early
        
        const src = signal.source;
        if (!sourceCounts[src]) sourceCounts[src] = 0;
        
        if (sourceCounts[src] < (sourceQuotas[src] || 5)) {
            truncatedSignals.push(signal);
            sourceCounts[src]++;
        } else {
            log.debug(`Truncated signal from ${src} due to source diversity quota.`);
        }
    }
    
    // Replace enrichedSignals with the truncated, balanced subset
    // HARD DATASET GUARD
    enrichedSignals.length = 0;
    for (const signal of truncatedSignals) {
        if (!signal || !signal.title || !signal.source || !signal.company || !signal.url || signal.title.toLowerCase().includes('undefined')) {
            log.warning('DROPPED_INVALID_SIGNAL');
            continue;
        }
        enrichedSignals.push(signal);
    }
    // --- END SOURCE DIVERSITY QUOTAS ---

    const qualifiedCount = enrichedSignals.length;
    log.info(`Signal enrichment complete. Balanced dataset contains ${qualifiedCount} signals.`);
    await Actor.setStatusMessage(`Qualified ${qualifiedCount} high-intent leads. Generating insights...`);

    // Push individual signals to dataset + charge per signal (H3: PPE)
    let chargedSignals = 0;
    const itemsToPush = [];
    
    for (const signal of enrichedSignals) {
        // --- COMMERCIAL READINESS POLISH SPRINT: TASK 1 (Freshness Filtering) ---
        const ageMs = Date.now() - new Date(signal.createdAt || new Date()).getTime();
        let ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        if (isNaN(ageDays) || ageDays < 0) ageDays = 0; // fallback for missing dates
        
        signal.contentAgeDays = ageDays;
        signal.freshnessOverride = false;
        
        // Exception rules: explicit high-value commercial behavior
        const exceptionRegex = /(moving away from|switching from|looking for alternatives|fed up with|replacing|better than|migration)/i;
        if (exceptionRegex.test(signal.content || '') || exceptionRegex.test(signal.title || '')) {
            signal.freshnessOverride = true;
        }

        if (ageDays <= 7) {
            signal.freshnessCategory = 'HOT';
            signal.intentScore = Math.min(100, signal.intentScore + 10);
            signal.confidence = Math.min(1.0, (signal.confidence || 0.5) + 0.1);
            if (signal.signalQuality === 'MEDIUM') signal.signalQuality = 'HIGH';
        } else if (ageDays <= 30) {
            signal.freshnessCategory = 'RECENT';
        } else if (ageDays <= 90) {
            signal.freshnessCategory = 'STALE';
            if (!signal.freshnessOverride) {
                signal.intentScore = Math.max(0, signal.intentScore - 15);
                if (signal.signalQuality === 'HIGH') signal.signalQuality = 'MEDIUM';
            }
        } else if (ageDays <= 180) {
            signal.freshnessCategory = 'OLD';
            if (!signal.freshnessOverride) {
                signal.intentScore = Math.max(0, signal.intentScore - 30);
                signal.signalQuality = 'LOW';
            }
        } else {
            // Older than 180 days
            signal.freshnessCategory = 'ANCIENT';
            if (!signal.freshnessOverride) {
                signal.signalQuality = 'REJECT';
                signal.rejectionReason = `Content too old (${ageDays} days) without explicit commercial exception`;
            } else {
                signal.freshnessCategory = 'OLD (EXCEPTED)';
            }
        }
        // --- END FRESHNESS FILTERING ---

        // STRICT FILTERING: Drop noisy / rejected signals completely to surface only 1-5 strong commercial opportunities
        if (signal.signalQuality === 'REJECT') {
            continue;
        }

        // Truncate content for payload safety
        if (signal.content && signal.content.length > 1500) {
            signal.content = signal.content.substring(0, 1500) + '... [TRUNCATED]';
        }

        itemsToPush.push(signal);
        forensics.FINAL_PUSH_COUNTS[signal.source] = (forensics.FINAL_PUSH_COUNTS[signal.source] || 0) + 1;
        chargedSignals++;

        // NEW WAVE 3: Smart Alerts
        if (monitoringMode !== 'off') {
            const alert = generateSmartAlert(signal);
            if (alert) {
                itemsToPush.push(alert);
            }
        }

        // H3: Charge per signal (PPE) — every signal is charged
        try {
            await Actor.charge({ eventName: 'result-signal', count: 1 });
        } catch (error) {
            // Charging may fail if user is on Apify free plan or has no card
            await Actor.setStatusMessage(`Billing limit reached (free plan?). Processed ${chargedSignals - 1} paid signals.`, { isStatusMessageTerminal: false });
            break;
        }
    }
    
    if (itemsToPush.length > 0) {
        const payloadSizeKB = (Buffer.byteLength(JSON.stringify(itemsToPush), 'utf8') / 1024).toFixed(2);
        log.info(`Serialized payload size: ${payloadSizeKB} KB`);
        await pushDataToApify(itemsToPush, 'signals');
        log.info('Dataset persistence complete.');
    }

    // Generate aggregated insights
    log.info('Generating aggregated insights...');
    const aggregated = aggregateByCompany(enrichedSignals);
    const companySummary = generateCompanyExecutiveSummary(aggregated);
    const highIntentSignals = identifyHighIntentSignals(enrichedSignals);
    
    // NEW Wave 2B & 3: Full Run Executive Summary / Weekly Digest
    const runSummary = generateExecutiveSummary(enrichedSignals, highIntentSignals, monitoringMode);

    // NEW Wave 3: Competitor Watch
    let competitorRisk = {};
    if (monitoringMode !== 'off' && competitorWatch.length > 0) {
        competitorRisk = calculateCompetitorRisk(aggregated, previousStats, competitorWatch);
    }

    // Push aggregated data
    const aggregatedItems = [];
    
    aggregatedItems.push({
        ...runSummary,
        competitorRisk,
        companyRollup: companySummary
    });

    // Save State for next run
    if (monitoringMode !== 'off') {
        const statsToSave = {};
        for (const comp of aggregated) {
            statsToSave[comp.company] = comp;
        }
        await saveMonitorState(seenHashes, statsToSave);
    }

    for (const companyInsight of aggregated) {
        aggregatedItems.push({
            _type: 'company_aggregate',
            ...companyInsight
        });
    }

    aggregatedItems.push({
        _type: 'high_intent_alerts',
        totalHighIntentSignals: highIntentSignals.length,
        signals: highIntentSignals.slice(0, 20) // Top 20
    });

    // NEW: Sales insights output
    const salesInsights = generateSalesInsights(enrichedSignals, aggregated);
    aggregatedItems.push({
        _type: 'sales_insights',
        ...salesInsights
    });
    
    const aggregatedPayloadSizeKB = (Buffer.byteLength(JSON.stringify(aggregatedItems), 'utf8') / 1024).toFixed(2);
    log.info(`Serialized payload size: ${aggregatedPayloadSizeKB} KB`);
    await pushDataToApify(aggregatedItems, 'aggregated insights');
    log.info('Dataset persistence complete.');

    log.info('Dark Funnel Intelligence Engine completed successfully', {
        totalSignals: enrichedSignals.length,
        companiesAnalyzed: aggregated.length,
        highIntentAlerts: highIntentSignals.length,
        chargedSignals,
    });

    log.info('--- SOURCE FORENSICS ---');
    for (const src of Object.keys(forensics.RAW_SOURCE_COUNTS)) {
        const raw = forensics.RAW_SOURCE_COUNTS[src] || 0;
        const post = forensics.POST_FILTER_COUNTS[src] || 0;
        const llm = forensics.LLM_ACCEPT_COUNTS[src] || 0;
        const fin = forensics.FINAL_PUSH_COUNTS[src] || 0;
        log.info(`${src}: ${raw} -> ${post} -> ${llm} -> ${fin}`);
    }

    const finalBuyingSignalCount = Object.values(forensics.FINAL_PUSH_COUNTS).reduce((a,b)=>a+b, 0);
    const sourceDiversity = Object.keys(forensics.FINAL_PUSH_COUNTS).filter(k => forensics.FINAL_PUSH_COUNTS[k] > 0).length;
    
    if (finalBuyingSignalCount < 3 || sourceDiversity < 2) {
        log.warning('LOW_CONFIDENCE: Final dataset lacks volume or source diversity. Run returned low commercial intelligence.');
    }

    await Actor.setStatusMessage(`Complete: ${finalBuyingSignalCount} signals, ${highIntentSignals.length} high-intent leads found.`, { isStatusMessageTerminal: true });

} catch (error) {
    log.error('Error during scraping', { error: error.message, stack: error.stack });
    throw error;
}

if (token && datasetId) {
    try {
        const infoResponse = await fetch(`https://api.apify.com/v2/datasets/${datasetId}?token=${token}`);
        if (infoResponse.ok) {
            const infoData = await infoResponse.json();
            console.log(`\nFinal dataset itemCount: ${infoData.data.itemCount}`);
        }
    } catch (e) {
        console.error('Failed to fetch final dataset metadata', e);
    }
}

await Actor.exit();
