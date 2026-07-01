import { Actor, log } from 'apify';

// Pipeline Stages
import { collectSignals } from './pipeline/collect.js';
import { classifySignals } from './pipeline/classify.js';
import { qualifySignals } from './pipeline/qualify.js';
import { enrichSignals } from './pipeline/enrich.js';
import { outputResults } from './pipeline/output.js';

// Utilities
import { enrichCompany } from './utils/enrichment.js';
import { loadMonitorState } from './utils/monitor.js';
import { buildTopicProfile } from './classifiers/topicProfile.js';

await Actor.init();

const token = process.env.APIFY_TOKEN;
const datasetId = process.env.APIFY_DEFAULT_DATASET_ID;

// Forensic dataset audit
if (process.env.DEBUG_MODE === 'true') {
    log.info('--- DATASET ROUTING FORENSIC AUDIT ---');
    log.info('Default dataset env:', { id: datasetId });
    log.info('Actor env dataset ID:', { id: Actor.getEnv().defaultDatasetId });
    log.info('Dataset info:', {
        id: datasetId,
        isLocal: process.env.APIFY_IS_AT_HOME === '1' ? false : true
    });
    log.info('--------------------------------------------');
}

const input = (await Actor.getInput()) ?? {};

// Support both old sources{} object AND new individual boolean toggles
let {
    companies = ['Notion', 'HubSpot'],
    templatePreset = 'custom',
    maxRequestsPerCrawl = 10,
    enableReddit,
    enableGithub,
    enableHackernews,
    enableNews,
    enableG2,
    enableLinkedin,
    sources,
    newsApiKey = null,
    monitoringMode = 'off',
    competitorWatch = [],
    knownCompetitors = [],
    skipLanguageFilter = false,
    forceEnableAll = false,
    webhookUrl = null,
    webhookBatchSize = 25
} = input;

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

// Resolve source toggles
const resolvedSources = {
    reddit: enableReddit ?? sources?.reddit ?? true,
    github: enableGithub ?? sources?.github ?? true,
    hackernews: enableHackernews ?? sources?.hackernews ?? true,
    news: enableNews ?? sources?.news ?? false,
    g2: enableG2 ?? sources?.g2 ?? true,
    linkedin: enableLinkedin ?? sources?.linkedin ?? true,
};

// Input validation
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

// Build topic profiles for each search query
// Each company entry is treated as a search query/topic
const topicProfiles = validCompanies.map(company => ({
    company,
    profile: buildTopicProfile(company),
}));

log.info('Starting Dark Funnel Intelligence Engine', {
    companies: validCompanies,
    sources: resolvedSources,
    maxResultsPerCompany: maxResults,
});

// Log topic profiles for debugging
if (process.env.DEBUG_MODE === 'true') {
    for (const { company, profile } of topicProfiles) {
        log.info(`Topic profile for "${company}":`, {
            primary: profile.primary,
            relatedCount: profile.related.length,
            commercialCount: profile.commercial.length,
        });
    }
}

await Actor.setStatusMessage(`Collecting signals from ${Object.values(resolvedSources).filter(Boolean).length} sources for ${validCompanies.length} companies...`);

// Fetch company enrichment profiles
log.info('Fetching company enrichment profiles...');
const companyProfiles = {};
for (const company of validCompanies) {
    companyProfiles[company] = await enrichCompany(company);
}

// Load Monitoring State
const monitorState = await loadMonitorState();
const seenHashes = monitorState.seenHashes;
const previousStats = monitorState.previousStats;
if (monitoringMode !== 'off') {
    log.info(`Monitoring Mode ACTIVE (${monitoringMode.toUpperCase()}). Tracking deltas against previous run.`);
}

try {
    const forensics = {
        POST_FILTER_COUNTS: {},
        LLM_ACCEPT_COUNTS: {}
    };

    // STAGE 1: Collect signals (Parallel execution)
    const { signals: allSignals, consecutiveFailures: updatedConsecutiveFailures } = await collectSignals(validCompanies, resolvedSources, maxResults, newsApiKey, monitorState.consecutiveFailures, forceEnableAll);

    if (allSignals.length === 0) {
        log.warning('No signals found. Try different company names or enable more sources.');
        await Actor.setValue('EXECUTIVE_SUMMARY', {
            totalCompanies: validCompanies.length,
            totalSignals: 0,
            avgSignalsPerCompany: '0',
            sentimentBreakdown: { positive: 0, negative: 0, neutral: 0 },
            topCompanies: [],
            highPriorityAlerts: [],
            generatedAt: new Date().toISOString(),
        });
        await Actor.exit();
        process.exit(0);
    }

    // STAGE 2: Classify Signals (Topic Relevance → Negative Filter → Commercial Intent)
    // Build a combined topic profile for classification
    const combinedTopicProfile = {
        primary: topicProfiles.flatMap(tp => tp.profile.primary),
        related: topicProfiles.flatMap(tp => tp.profile.related),
        commercial: topicProfiles[0]?.profile.commercial || [],
        negative: topicProfiles[0]?.profile.negative || [],
        originalQuery: validCompanies.join(', '),
    };
    const classifiedSignals = classifySignals(allSignals, validCompanies, knownCompetitors, combinedTopicProfile, skipLanguageFilter);

    // STAGE 3: Qualify Signals (LLM Truth Layer)
    // Pass the search query for LLM context
    const searchQuery = validCompanies.join(', ');
    const qualifiedSignals = await qualifySignals(classifiedSignals, openaiApiKey, searchQuery, forensics);

    // STAGE 4: Enrich & Quality Rank Signals (Outreach, ICP fit, No source quotas)
    const enrichedFinalSignals = enrichSignals(qualifiedSignals, companyProfiles, seenHashes, monitoringMode, validCompanies, maxResults);

    // STAGE 5: Output Results (KPIs, aggregated summaries, KVS and dataset persistence)
    const { finalBuyingSignalCount, highIntentAlertsCount } = await outputResults({
        enrichedSignals: enrichedFinalSignals,
        monitoringMode,
        competitorWatch,
        previousStats,
        seenHashes,
        companyProfiles,
        validCompanies,
        token,
        datasetId,
        consecutiveFailures: updatedConsecutiveFailures,
        webhookUrl,
        webhookBatchSize,
        llmEnabled: !!openaiApiKey
    });

    await Actor.setStatusMessage(`Complete: ${finalBuyingSignalCount} signals, ${highIntentAlertsCount} high-intent leads found.`, { isStatusMessageTerminal: true });

} catch (error) {
    log.error('Error during scraping', { error: error.message, stack: error.stack });
    throw error;
}

await Actor.exit();
