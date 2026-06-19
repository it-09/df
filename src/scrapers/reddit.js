import { Actor, log } from 'apify';
import { isSeoSpam, hasHumanIntent } from '../utils/spamPatterns.js';

/**
 * Scrape Reddit posts using the FREE Reddit Scraper Pro actor.
 * 
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of Reddit signals
 */
export async function scrapeReddit(companies, maxResults = 10) {
    const allSignals = [];
    
    const ACTOR_ID = 'spry_wholemeal/reddit-scraper'; 

    for (const company of companies) {
        log.info(`Calling external FREE Reddit Scraper Pro for: ${company}`);
        const companyStart = Date.now();
        let diagSpamRejected = 0;
        let totalItems = 0;
        
        try {
            // We use mode: 'search' as per the Actor's documentation
            // Fetch extra results to account for spam rejection
            const run = await Actor.call(ACTOR_ID, {
                mode: "search",
                searchTargets: [
                    { query: company, maxResults: maxResults * 2 }
                ],
                timeframe: "month" // Limit to recent results
            });

            const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems();
            totalItems = items.length;
            log.info(`External scraper returned ${totalItems} items for ${company}`);

            for (const item of items) {
                // Stop when we hit the max limit for this company
                if (allSignals.filter(s => s.company === company).length >= maxResults) break;

                // Match against the fields from your JSON preview
                const title = item.title || '';
                const content = item.text || '';
                const urlPath = item.url || '';
                
                const fullText = (title + " " + content).toLowerCase();
                
                // Hard Reject noise
                if (/meme|joke|hilarious|funny|satire/i.test(fullText)) continue;
                
                const isSpam = isSeoSpam(fullText);
                const hasIntent = hasHumanIntent(fullText);

                if (isSpam && !hasIntent) {
                    diagSpamRejected++;
                    log.debug(`REDDIT_SPAM_REJECTED: ${title}`);
                    continue;
                }

                // Must have some commercial/intent keyword
                if (!hasIntent && !/(alternatives|replacing|migration|frustrat|fed up|switch|recommendation|better than|comparison|pricing|evaluation|vs|problems)/i.test(fullText)) {
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
            log.info(`REDDIT_RAW [${company}]: ${totalItems}`);
            log.info(`REDDIT_FILTERED [${company}]: ${allSignals.filter(s => s.company === company).length}`);
            log.info(`REDDIT_DURATION_MS [${company}]: ${Date.now() - companyStart}`);
        }
    }

    return allSignals;
}