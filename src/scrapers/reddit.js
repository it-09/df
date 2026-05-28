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
 * Scrape Reddit using native boolean search on old.reddit.com
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of Reddit signals
 */
export async function scrapeReddit(companies, maxResults = 50) {
    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const signals = [];
            
            // Boolean logic offloads the filtering to Reddit!
            // We search globally, but force a high commercial-intent context
            const searchQuery = `"${company}" AND (alternative OR vs OR pricing OR replace OR recommendation OR migrate OR expensive)`;
            const url = `https://old.reddit.com/search?q=${encodeURIComponent(searchQuery)}&sort=new&t=year`;
            
            log.info(`Scraping Reddit (Native) for: ${company}`);
            
            try {
                const response = await axiosWithRetry({ method: 'GET', url });
                const $ = cheerio.load(response.data);
                
                $('.search-result').each((i, el) => {
                    if (signals.length >= maxResults) return;
                    
                    const title = $(el).find('.search-title').text().trim();
                    const urlPath = $(el).find('.search-title').attr('href');
                    const author = $(el).find('.author').text().trim();
                    const subreddit = $(el).find('.search-subreddit-link').text().trim();
                    const timeStr = $(el).find('.search-time time').attr('datetime');
                    
                    // We extract the snippet to fuel our intent scoring engine
                    const snippet = $(el).find('.search-result-body').text().trim();
                    
                    if (!title && !snippet) return;
                    
                    signals.push({
                        company,
                        source: 'reddit',
                        title: title || '',
                        content: snippet || '',
                        url: urlPath ? (urlPath.startsWith('http') ? urlPath : `https://old.reddit.com${urlPath}`) : url,
                        author: author || 'unknown',
                        subreddit: subreddit || '',
                        createdAt: timeStr || new Date().toISOString(),
                        scrapedAt: new Date().toISOString()
                    });
                });
                
                log.info(`Collected ${signals.length} highly targeted Reddit signals for ${company}`);
            } catch (err) {
                log.warning(`Reddit native scraper failed for ${company}`, { error: err.message });
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