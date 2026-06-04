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
            log.debug(`LinkedIn request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`, { error: err.message });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Scrape LinkedIn posts using Yahoo Search Dorking.
 * Yahoo Search is extremely permissive with bots and datacenter IPs compared to Google/DDG.
 * Zero API keys required.
 * 
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of LinkedIn signals
 */
export async function scrapeLinkedIn(companies, maxResults = 10) {
    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const signals = [];
            
            // Dorking Yahoo for LinkedIn posts
            const searchQuery = `site:linkedin.com/posts "${company}" (alternative OR vs OR pricing OR switch OR replace OR frustrated)`;
            const url = `https://search.yahoo.com/search?p=${encodeURIComponent(searchQuery)}&n=${Math.min(maxResults + 5, 20)}`;
            
            log.info(`Scraping LinkedIn (via Yahoo Dorking) for: ${company}`);
            
            try {
                const response = await axiosWithRetry({ method: 'GET', url });
                const $ = cheerio.load(response.data);

                $('.algo').each((i, el) => {
                    if (signals.length >= maxResults) return;
                    
                    const title = $(el).find('h3').text().trim();
                    let urlPath = $(el).find('a').first().attr('href') || '';
                    const ruMatch = urlPath.match(/\/RU=([^/]+)/);
                    if (ruMatch) urlPath = decodeURIComponent(ruMatch[1]);
                    
                    const snippet = $(el).find('.compText').text().trim() || $(el).find('.fz-ms').text().trim();

                    // Skip non-post pages
                    if (!urlPath.includes('/posts/') && !urlPath.includes('/feed/update/')) return;
                    if (!title && !snippet) return;

                    // Extract author from title (e.g., "John Doe on LinkedIn: ...")
                    let author = 'LinkedIn User';
                    const authorMatch = title.match(/^(.*?)(?:\s+on\s+LinkedIn|\s+[-–—]\s+LinkedIn)/i);
                    if (authorMatch && authorMatch[1]) {
                        author = authorMatch[1].trim();
                    }

                    // Extract job title from snippet if present
                    let detectedRole = null;
                    const roleMatch = snippet.match(/(?:^|\s)((?:CEO|CTO|VP|Director|Head|Manager|Lead|Founder|Co-Founder|Chief)[^.;,]*?)(?:\s+at\s+|\s+@\s+|\s+of\s+)/i);
                    if (roleMatch) {
                        detectedRole = roleMatch[1].trim();
                    }

                    signals.push({
                        company,
                        source: 'linkedin',
                        title: title || `LinkedIn Post: ${company}`,
                        content: snippet,
                        url: urlPath,
                        author,
                        subreddit: 'linkedin_posts',
                        detectedRole: detectedRole,
                        createdAt: new Date().toISOString(),
                        scrapedAt: new Date().toISOString()
                    });
                });

                log.info(`Collected ${signals.length} high-intent LinkedIn posts for ${company}`);
            } catch (err) {
                log.warning(`LinkedIn scraping failed for ${company}`, { error: err.message });
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
