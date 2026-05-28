// Hacker News scraper module
import axios from 'axios';
import { log } from 'apify';

/**
 * Retry wrapper for axios requests with exponential backoff
 */
async function axiosWithRetry(config, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await axios({ timeout: 15000, ...config });
        } catch (err) {
            if (attempt === retries) throw err;
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            log.debug(`HN request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`, { error: err.message });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Strip HTML tags from text (HN Algolia returns raw HTML)
 */
function stripHtml(text) {
    if (!text) return '';
    return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Scrape Hacker News for company mentions using Algolia API
 * Searches stories and comments
 * @param {string[]} companies - Array of company names to search
 * @param {number} maxResults - Maximum results per company (per type: story + comment)
 * @returns {Promise<Array>} - Array of signals
 */
export async function scrapeHackerNews(companies, maxResults = 10) {
    const hitsPerPage = Math.min(maxResults, 50); // Algolia max is 1000, but keep it reasonable

    // M1: Parallelize across companies
    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const signals = [];
            const query = encodeURIComponent(company);

            try {
                // Search stories
                const storiesUrl = `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&hitsPerPage=${hitsPerPage}`;
                const response = await axiosWithRetry({ method: 'GET', url: storiesUrl });

                if (response.data && response.data.hits) {
                    for (const hit of response.data.hits) {
                        signals.push({
                            company,
                            source: 'hackernews',
                            title: hit.title || '',
                            content: stripHtml(hit.story_text || hit.comment_text || '').substring(0, 2000),
                            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
                            author: hit.author || 'unknown',
                            points: hit.points || 0,
                            numComments: hit.num_comments || 0,
                            createdAt: hit.created_at,
                            scrapedAt: new Date().toISOString()
                        });
                    }
                }
            } catch (err) {
                log.warning(`HN stories error for ${company}`, { error: err.message });
            }

            try {
                // Also search comments
                const commentsUrl = `https://hn.algolia.com/api/v1/search?query=${query}&tags=comment&hitsPerPage=${hitsPerPage}`;
                const commentsResponse = await axiosWithRetry({ method: 'GET', url: commentsUrl });

                if (commentsResponse.data && commentsResponse.data.hits) {
                    for (const hit of commentsResponse.data.hits) {
                        signals.push({
                            company,
                            source: 'hackernews',
                            title: `Comment on: ${hit.story_title || 'HN Thread'}`,
                            content: stripHtml(hit.comment_text || '').substring(0, 2000),
                            url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
                            author: hit.author || 'unknown',
                            createdAt: hit.created_at,
                            scrapedAt: new Date().toISOString()
                        });
                    }
                }
            } catch (err) {
                log.warning(`HN comments error for ${company}`, { error: err.message });
            }

            return signals;
        })
    );

    // Collect successful results
    const allSignals = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            allSignals.push(...result.value);
        }
    }

    return allSignals;
}