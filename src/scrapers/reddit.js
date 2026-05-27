// Reddit scraper using Apify's Reddit Search Actor
import { Actor } from 'apify';

/**
 * Scrape Reddit by chaining to Apify's Reddit Search Scraper Actor
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of Reddit signals
 */
export async function scrapeReddit(companies, maxResults = 50) {
    const signals = [];

    try {
        for (const company of companies) {
            console.log(`Calling Reddit Actor for: ${company}`);

            // Call Apify's Reddit Scraper Actor
            const run = await Actor.call('boneswill/reddit-scraper', {
                search: company,
                sort: 'new',
                maxItems: Math.min(maxResults, 100),
                scrollTimeout: 40,
                searchResultType: 'posts'
            });

            // Get dataset from the Reddit actor run
            const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems();

            // Transform Reddit actor output to our signal format
            for (const item of items) {
                signals.push({
                    company,
                    source: 'reddit',
                    title: item.title || '',
                    content: item.body || item.selftext || '',
                    url: item.url || '',
                    author: item.author || '',
                    subreddit: item.subreddit || '',
                    createdAt: item.created_utc ? new Date(item.created_utc * 1000).toISOString() : null,
                    upvotes: item.ups || 0,
                    scrapedAt: new Date().toISOString()
                });
            }

            console.log(`Collected ${items.length} Reddit signals for ${company}`);
        }
    } catch (error) {
        console.error('Reddit actor chaining failed:', error.message);
        // Return empty array on failure - don't crash the entire actor
    }

    return signals;
}