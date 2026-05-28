// Dark Funnel Intelligence Engine - Main Orchestrator
import { Actor, log } from 'apify';

// Scrapers
import { scrapeReddit } from './scrapers/reddit.js';
import { scrapeGitHub } from './scrapers/github.js';
import { scrapeHackerNews } from './scrapers/hackernews.js';
import { scrapeNews } from './scrapers/news.js';
import { scrapeG2 } from './scrapers/g2.js';

// Classifiers
import { analyzeSentiment, analyzeAspectSentiment } from './classifiers/sentiment.js';
import { detectBuyingSignals, detectCompetitors, predictBuyingStage } from './classifiers/intent.js';
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
    // Legacy sources object (backward compat)
    sources,
    newsApiKey = null,
    openaiApiKey = null,
    monitoringMode = 'off',
    competitorWatch = [],
    knownCompetitors = []
} = input;

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
    reddit: enableReddit ?? sources?.reddit ?? false,
    github: enableGithub ?? sources?.github ?? true,
    hackernews: enableHackernews ?? sources?.hackernews ?? true,
    news: enableNews ?? sources?.news ?? false,
    g2: enableG2 ?? sources?.g2 ?? true,
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

    log.info(`Total raw signals collected: ${allSignals.length}`);

    if (allSignals.length === 0) {
        log.warning('No signals found. Try different company names or enable more sources.');
        await Actor.pushData({
            _type: 'executive_summary',
            totalCompanies: validCompanies.length,
            totalSignals: 0,
            avgSignalsPerCompany: '0',
            sentimentBreakdown: { positive: 0, negative: 0, neutral: 0 },
            topCompanies: [],
            highPriorityAlerts: [],
            generatedAt: new Date().toISOString(),
        await Actor.exit();
        return;
    }

    // Deduplicate signals
    allSignals = deduplicateSignals(allSignals);
    log.info(`After deduplication: ${allSignals.length} signals`);

    // STAGE 1 & 2: Heuristic Filtering
    log.info('Running Stage 1 & 2 Heuristic Filtering...');
    const heuristicSignals = allSignals.map(signal => {
        const fullText = `${signal.title || ''} ${signal.content || ''}`;
        const cleanedText = cleanText(fullText);

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
            buyingSignals, sentiment, personaSignals, painSignals, switchSignals, buyingStage
        }, signal.source, signal.subreddit);

        const leadPriority = calculateLeadPriority({
            intentScore, painSignals, switchSignals, personaSignals, buyingSignals, competitorSignals, buyingStage, commercialRelevanceLevel
        });

        return {
            ...signal,
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
                    finalScore = llmResult.intentScore;
                    if (finalScore >= 80) leadPriority = 'URGENT';
                    else if (finalScore >= 60) leadPriority = 'HIGH';
                    else leadPriority = 'MEDIUM';
                    whyHighIntent = llmResult.explanation;
                    
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

    log.info('Signal enrichment complete');

    // Push individual signals to dataset + charge per signal (H3: PPE)
    let chargedSignals = 0;
    for (const signal of enrichedSignals) {
        await Actor.pushData(signal);
        chargedSignals++;

        // NEW WAVE 3: Smart Alerts
        if (monitoringMode !== 'off') {
            const alert = generateSmartAlert(signal);
            if (alert) {
                await Actor.pushData(alert);
            }
        }

        // H3: Charge per signal (PPE) — skip first 10 as free trial
        if (chargedSignals > 10) {
            try {
                await Actor.charge({ eventName: 'result-signal', count: 1 });
            } catch {
                // Charging may fail if PPE not configured or user on free plan — that's OK
            }
        }
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
    await Actor.pushData({
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
        await Actor.pushData({
            _type: 'company_aggregate',
            ...companyInsight
        });
    }

    await Actor.pushData({
        _type: 'high_intent_alerts',
        totalHighIntentSignals: highIntentSignals.length,
        signals: highIntentSignals.slice(0, 20) // Top 20
    });

    // NEW: Sales insights output
    const salesInsights = generateSalesInsights(enrichedSignals, aggregated);
    await Actor.pushData({
        _type: 'sales_insights',
        ...salesInsights
    });

    log.info('Dark Funnel Intelligence Engine completed successfully', {
        totalSignals: enrichedSignals.length,
        companiesAnalyzed: aggregated.length,
        highIntentAlerts: highIntentSignals.length,
        chargedSignals: Math.max(0, chargedSignals - 10),
    });

} catch (error) {
    log.error('Error during scraping', { error: error.message, stack: error.stack });
    throw error;
}

await Actor.exit();