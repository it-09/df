import axios from 'axios';
import * as cheerio from 'cheerio';
import { log } from 'apify';

/**
 * Scrape G2 reviews using Google Dorks to bypass G2's Cloudflare protection safely.
 * This fetches the most relevant indexed reviews without requiring residential proxies.
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of G2 signals
 */
export async function scrapeG2(companies, maxResults = 10) {
    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const signals = [];
            
            // Using DuckDuckGo HTML search as a proxy for G2 dorking to avoid 403s on G2 directly
            const searchQuery = `site:g2.com/products/"${company}"/reviews (dislike OR alternatives OR switch OR expensive OR slow)`;
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
            
            log.info(`Scraping G2 Reviews (via Dorking) for: ${company}`);
            
            try {
                const response = await axios({
                    method: 'GET',
                    url,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    },
                    timeout: 15000
                });
                
                const $ = cheerio.load(response.data);
                
                $('.result').each((i, el) => {
                    if (signals.length >= maxResults) return;
                    
                    const title = $(el).find('.result__title').text().trim();
                    const urlPath = $(el).find('.result__url').attr('href');
                    const snippet = $(el).find('.result__snippet').text().trim();
                    
                    // Filter out non-review pages (like category pages)
                    if (!title.toLowerCase().includes('review') && !snippet.toLowerCase().includes('review')) return;
                    
                    signals.push({
                        company,
                        source: 'g2',
                        title: title || `G2 Review: ${company}`,
                        content: snippet || '',
                        url: urlPath || `https://www.g2.com/products/${company.toLowerCase()}/reviews`,
                        author: 'G2 Reviewer', // Anonymous via Dork
                        subreddit: 'g2_reviews',
                        createdAt: new Date().toISOString(),
                        scrapedAt: new Date().toISOString()
                    });
                });
                
                log.info(`Collected ${signals.length} high-intent G2 reviews for ${company}`);
            } catch (err) {
                log.warning(`G2 scraping failed for ${company}`, { error: err.message });
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
