import axios from 'axios';
import * as cheerio from 'cheerio';
import { log } from 'apify';

/**
 * Retry wrapper for axios requests with exponential backoff
 */
async function axiosWithRetry(config, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await axios({
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                ...config
            });
        } catch (err) {
            if (attempt === retries) throw err;
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            log.debug(`Reddit request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`, { error: err.message });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Scrape Reddit posts using Yahoo Search Dorking.
 * Yahoo Search bypasses Reddit's strict datacenter IP blocks natively.
 * Zero API keys required.
 * 
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of Reddit signals
 */
export async function scrapeReddit(companies, maxResults = 10) {
    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const signals = [];
            
            // Dorking Yahoo for Reddit posts
            const searchQuery = `site:reddit.com "${company}" (alternative OR vs OR pricing OR switch OR replace OR frustrated)`;
            const url = `https://search.yahoo.com/search?p=${encodeURIComponent(searchQuery)}&n=${Math.min(maxResults + 5, 20)}`;
            
            log.info(`Scraping Reddit (via Yahoo Dorking) for: ${company}`);
            
            try {
                const response = await axiosWithRetry({ method: 'GET', url });
                const $ = cheerio.load(response.data);

                $('.algo').each((i, el) => {
                    if (signals.length >= maxResults) return;
                    
                    const title = $(el).find('h3').text().trim();
                    let urlPath = $(el).find('a').first().attr('href') || '';
                    
                    // Extract actual URL from Yahoo tracking link
                    const ruMatch = urlPath.match(/\/RU=([^/]+)/);
                    if (ruMatch) urlPath = decodeURIComponent(ruMatch[1]);
                    
                    const snippet = $(el).find('.compText').text().trim() || $(el).find('.fz-ms').text().trim();

                    if (!urlPath.includes('/comments/')) return;
                    if (!title && !snippet) return;

                    // Extract subreddit from URL
                    let subreddit = 'reddit_user';
                    const subMatch = urlPath.match(/\/r\/([^/]+)/i);
                    if (subMatch && subMatch[1]) {
                        subreddit = `r/${subMatch[1]}`;
                    }

                    signals.push({
                        company,
                        source: 'reddit',
                        title: title || `Reddit Post: ${company}`,
                        content: snippet,
                        url: urlPath,
                        author: 'Reddit User',
                        subreddit: subreddit,
                        createdAt: new Date().toISOString(),
                        scrapedAt: new Date().toISOString()
                    });
                });

                log.info(`Collected ${signals.length} high-intent Reddit posts for ${company}`);
            } catch (err) {
                log.warning(`Reddit scraping failed for ${company}`, { error: err.message });
            }

            return signals;
        })
    );

    const allSignals = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            allSignals.push(...result.value);
        }
    }

    return allSignals;
}