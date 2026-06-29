import { Actor, log } from 'apify';
import { isSeoSpam, hasHumanIntent, isMarketplaceListing, isPersonalStory } from '../utils/spamPatterns.js';

/**
 * Scrape Reddit posts using the FREE Reddit Scraper Pro actor.
 *
 * @param {string[]} companies - Companies/topics to search for
 * @param {number} maxResults - Maximum results per company
 * @param {Object|null} topicProfile - Optional topic profile for relevance filtering
 * @returns {Promise<Array>} - Array of Reddit signals
 */
export async function scrapeReddit(companies, maxResults = 10, topicProfile = null) {
    const allSignals = [];

    const ACTOR_ID = 'spry_wholemeal/reddit-scraper';

    for (const company of companies) {
        log.info(`Calling external FREE Reddit Scraper Pro for: ${company}`);
        const companyStart = Date.now();
        let diagSpamRejected = 0;
        let diagNegativeRejected = 0;
        let totalItems = 0;

        try {
            // We use mode: 'search' as per the Actor's documentation
            // Fetch extra results to account for spam/rejection
            const run = await Actor.call(ACTOR_ID, {
                mode: "search",
                searchTargets: [
                    { query: company, maxResults: maxResults * 3 }
                ],
                timeframe: "month"
            });

            const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems();
            totalItems = items.length;
            log.info(`External scraper returned ${totalItems} items for ${company}`);

            for (const item of items) {
                // Stop when we hit the max limit for this company
                if (allSignals.filter(s => s.company === company).length >= maxResults) break;

                const title = item.title || '';
                const content = item.text || '';
                const urlPath = item.url || '';

                const fullText = (title + " " + content).toLowerCase();

                // --- LAYER 1: Hard Reject - Meme/Joke ---
                if (/meme|joke|hilarious|funny|satire|lol|lmao|shitpost/i.test(fullText)) {
                    diagSpamRejected++;
                    continue;
                }

                // --- LAYER 2: Marketplace Detection ---
                if (isMarketplaceListing(fullText)) {
                    diagNegativeRejected++;
                    log.debug(`REDDIT_MARKETPLACE_REJECTED: ${title}`);
                    continue;
                }

                // --- LAYER 3: Personal Story Detection ---
                if (isPersonalStory(fullText)) {
                    diagNegativeRejected++;
                    log.debug(`REDDIT_PERSONAL_REJECTED: ${title}`);
                    continue;
                }

                // --- LAYER 4: SEO Spam ---
                const isSpam = isSeoSpam(fullText);
                const hasIntent = hasHumanIntent(fullText);

                if (isSpam && !hasIntent) {
                    diagSpamRejected++;
                    log.debug(`REDDIT_SPAM_REJECTED: ${title}`);
                    continue;
                }

                // --- LAYER 5: Topic-Specific Commercial Intent ---
                // Must have commercial/intent keywords relevant to the topic
                const commercialKeywords = topicProfile?.commercial || [
                    'alternatives', 'replacing', 'migration', 'frustrat', 'fed up',
                    'switch', 'recommendation', 'better than', 'comparison', 'pricing',
                    'evaluation', 'vs', 'problems', 'looking for', 'need', 'recommend',
                    'anyone using', 'what do you use', 'considering', 'evaluating',
                    'demo', 'trial', 'implementation', 'integration', 'api'
                ];

                const hasCommercialKeyword = commercialKeywords.some(kw =>
                    fullText.includes(kw.toLowerCase())
                );

                if (!hasIntent && !hasCommercialKeyword) {
                    continue;
                }

                // --- LAYER 6: Generic AI / Non-B2B Check ---
                const genericAIIndicators = [
                    'what is ai', 'future of ai', 'ai is taking over', 'ai revolution',
                    'chatgpt', 'llm', 'neural network', 'deep learning'
                ];
                const isGenericAI = genericAIIndicators.some(indicator => fullText.includes(indicator));
                const hasTopicKeyword = topicProfile?.primary?.some(kw => fullText.includes(kw.toLowerCase())) ?? true;

                if (isGenericAI && !hasTopicKeyword) {
                    diagNegativeRejected++;
                    continue;
                }

                allSignals.push({
                    company,
                    source: 'reddit',
                    title: title || `Reddit Post: ${company}`,
                    content: content,
                    url: urlPath,
                    author: item.author || 'Reddit User',
                    subreddit: item.subreddit ? `r/${item.subreddit}` : 'reddit_user',
                    createdAt: item.created_utc_iso || new Date().toISOString(),
                    scrapedAt: item.scraped_at_iso || new Date().toISOString()
                });
            }
        } catch (err) {
            log.error(`Failed to call external Reddit scraper for ${company}`, { error: err.message });
        }

        log.info(`Collected ${allSignals.filter(s => s.company === company).length} high-intent Reddit posts for ${company}`);
        if (process.env.DEBUG_MODE === 'true') {
            log.info(`REDDIT_SPAM_REJECTED [${company}]: ${diagSpamRejected}`);
            log.info(`REDDIT_NEGATIVE_REJECTED [${company}]: ${diagNegativeRejected}`);
            log.info(`REDDIT_RAW [${company}]: ${totalItems}`);
            log.info(`REDDIT_FILTERED [${company}]: ${allSignals.filter(s => s.company === company).length}`);
            log.info(`REDDIT_DURATION_MS [${company}]: ${Date.now() - companyStart}`);
        }
    }

    return allSignals;
}
