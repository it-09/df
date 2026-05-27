// Dark Funnel Intelligence Engine - Main Orchestrator
import { Actor } from 'apify';
import { Dataset } from 'crawlee';

// Scrapers
import { scrapeReddit } from './scrapers/reddit.js';
import { scrapeGitHub } from './scrapers/github.js';
import { scrapeHackerNews } from './scrapers/hackernews.js';
import { scrapeNews } from './scrapers/news.js';

// Classifiers
import { analyzeSentiment, analyzeAspectSentiment } from './classifiers/sentiment.js';
import { detectBuyingSignals, detectCompetitors, predictBuyingStage } from './classifiers/intent.js';
import { extractPersona, isDecisionMaker, scorePersonaInfluence } from './classifiers/persona.js';

// Utilities
import { deduplicateSignals, calculateConfidence, cleanText } from './utils/normalizer.js';
import { aggregateByCompany, generateExecutiveSummary, identifyHighIntentSignals } from './utils/aggregator.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    companies = ["Notion", "HubSpot"],
    maxRequestsPerCrawl = 50,
    sources = {
        reddit: true,
        github: true,
        hackernews: true,
        news: false
    },
    newsApiKey = null,
    knownCompetitors = []
} = input;

if (!companies || companies.length === 0) {
    throw new Error('No companies provided in input');
}

console.info('Starting Dark Funnel Intelligence Engine', {
    companies,
    sources,
    maxRequests: maxRequestsPerCrawl
});

// Use proxy when running on Apify platform (has authentication)
const proxyConfiguration = await Actor.createProxyConfiguration();

// Collect signals from all enabled sources
let allSignals = [];

try {
    // 1. Scrape Reddit (using Apify actor chaining)
    if (sources.reddit) {
        try {
            console.log('Scraping Reddit via Apify actor...');
            const redditSignals = await scrapeReddit(companies, 50);
            allSignals.push(...redditSignals);
            console.log(`Reddit: ${redditSignals.length} signals collected`);
        } catch (redditError) {
            console.error('Reddit scraping failed, continuing with other sources:', redditError.message);
        }
    }

    // 2. Scrape GitHub
    if (sources.github) {
        console.info('Scraping GitHub...');
        const githubSignals = await scrapeGitHub(companies, 10);
        allSignals.push(...githubSignals);
        console.info(`GitHub: ${githubSignals.length} signals collected`);
    }

    // 3. Scrape Hacker News
    if (sources.hackernews) {
        console.info('Scraping Hacker News...');
        const hnSignals = await scrapeHackerNews(companies, 10);
        allSignals.push(...hnSignals);
        console.info(`Hacker News: ${hnSignals.length} signals collected`);
    }

    // 4. Scrape News (optional)
    if (sources.news && newsApiKey) {
        console.info('Scraping News...');
        const newsSignals = await scrapeNews(companies, newsApiKey, 10);
        allSignals.push(...newsSignals);
        console.info(`News: ${newsSignals.length} signals collected`);
    }

    console.info(`Total raw signals collected: ${allSignals.length}`);

    // Deduplicate signals
    allSignals = deduplicateSignals(allSignals);
    console.info(`After deduplication: ${allSignals.length} signals`);

    // Enrich signals with NLP classification
    console.info('Enriching signals with NLP analysis...');
    const enrichedSignals = allSignals.map(signal => {
        const fullText = `${signal.title || ''} ${signal.content || ''}`;
        const cleanedText = cleanText(fullText);

        // Sentiment analysis
        const sentiment = analyzeAspectSentiment(cleanedText, signal.company, knownCompetitors);

        // Buying signals
        const buyingSignals = detectBuyingSignals(cleanedText);

        // Competitor signals
        const competitorSignals = detectCompetitors(cleanedText, knownCompetitors);

        // Persona extraction
        const personaSignals = extractPersona(cleanedText);

        // Predict buying stage
        const buyingStage = predictBuyingStage(buyingSignals, sentiment);

        // Calculate overall confidence
        const confidence = calculateConfidence({
            ...signal,
            sentiment,
            buyingSignals,
            personaSignals
        });

        return {
            ...signal,
            sentiment: {
                score: sentiment.overall.score,
                label: sentiment.overall.label,
                towardCompany: sentiment.towardCompany,
                towardCompetitors: sentiment.towardCompetitors
            },
            buyingSignals: {
                hasBudgetSignal: buyingSignals.hasBudgetSignal,
                hasTimelineSignal: buyingSignals.hasTimelineSignal,
                hasTechnicalSignal: buyingSignals.hasTechnicalSignal,
                hasEvaluationSignal: buyingSignals.hasEvaluationSignal,
                hasDecisionSignal: buyingSignals.hasDecisionSignal,
                confidence: buyingSignals.confidence,
                signals: buyingSignals.signals
            },
            competitorSignals: {
                hasCompetitiveSignal: competitorSignals.hasCompetitiveSignal,
                competitors: competitorSignals.competitors
            },
            personaSignals: {
                jobTitles: personaSignals.jobTitles,
                departments: personaSignals.departments,
                seniorityLevels: personaSignals.seniorityLevels,
                isDecisionMaker: isDecisionMaker(personaSignals),
                influenceScore: scorePersonaInfluence(personaSignals)
            },
            buyingStage,
            confidence
        };
    });

    console.info('Signal enrichment complete');

    // Push individual signals to dataset
    for (const signal of enrichedSignals) {
        await Dataset.pushData(signal);
    }

    // Generate aggregated insights
    console.info('Generating aggregated insights...');
    const aggregated = aggregateByCompany(enrichedSignals);
    const executiveSummary = generateExecutiveSummary(aggregated);
    const highIntentSignals = identifyHighIntentSignals(enrichedSignals);

    // Push aggregated data
    await Dataset.pushData({
        _type: 'executive_summary',
        ...executiveSummary
    });

    for (const companyInsight of aggregated) {
        await Dataset.pushData({
            _type: 'company_aggregate',
            ...companyInsight
        });
    }

    await Dataset.pushData({
        _type: 'high_intent_alerts',
        totalHighIntentSignals: highIntentSignals.length,
        signals: highIntentSignals.slice(0, 20) // Top 20
    });

    console.info('Dark Funnel Intelligence Engine completed successfully', {
        totalSignals: enrichedSignals.length,
        companiesAnalyzed: aggregated.length,
        highIntentAlerts: highIntentSignals.length
    });

} catch (error) {
    console.error('Error during scraping', { error: error.message, stack: error.stack });
    throw error;
}

await Actor.exit();