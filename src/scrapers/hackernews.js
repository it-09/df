// Hacker News scraper module
import axios from 'axios';

/**
 * Scrape Hacker News for company mentions using Algolia API
 * Searches stories and comments
 * @param {string[]} companies - Array of company names to search
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of signals
 */
export async function scrapeHackerNews(companies, maxResults = 10) {
    const signals = [];

    for (const company of companies) {
        try {
            // Search HN using Algolia API (free, unlimited)
            const query = encodeURIComponent(company);
            const url = `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&hitsPerPage=${maxResults}`;

            const response = await axios.get(url);

            if (response.data && response.data.hits) {
                for (const hit of response.data.hits) {
                    signals.push({
                        company,
                        source: 'hackernews',
                        title: hit.title || '',
                        content: hit.story_text || hit.comment_text || '',
                        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
                        author: hit.author || 'unknown',
                        points: hit.points || 0,
                        numComments: hit.num_comments || 0,
                        createdAt: hit.created_at,
                        scrapedAt: new Date().toISOString()
                    });
                }
            }

            // Also search comments
            const commentsUrl = `https://hn.algolia.com/api/v1/search?query=${query}&tags=comment&hitsPerPage=${maxResults}`;
            const commentsResponse = await axios.get(commentsUrl);

            if (commentsResponse.data && commentsResponse.data.hits) {
                for (const hit of commentsResponse.data.hits) {
                    signals.push({
                        company,
                        source: 'hackernews',
                        title: `Comment on: ${hit.story_title || 'HN Thread'}`,
                        content: hit.comment_text || '',
                        url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
                        author: hit.author || 'unknown',
                        createdAt: hit.created_at,
                        scrapedAt: new Date().toISOString()
                    });
                }
            }

        } catch (err) {
            console.error(`Hacker News scraping error for ${company}:`, err.message);
        }
    }

    return signals;
}