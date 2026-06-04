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
            const seenUrls = new Set();
            
            const queries = [
                `alternatives`, `vs`, `pricing`, `problems`, 
                `migration`, `replacing`, `"fed up"`, `recommendation`
            ];

            const SEO_SPAM_PATTERNS = [
                /\btop\s+\d+\b/i, /\bbest\s+.*alternative/i, /\b2025\b/i, /\b2026\b/i,
                /\bguide\b/i, /\breview\b/i, /\bcomparison\b/i, /\bcompetitors?\b/i,
                /\bvs\b/i, /\bversus\b/i, /\bmarket\s+share\b/i, /\branking\b/i,
                /\blist\s+of\b/i, /\bsoftware\s+like\b/i, /\balternative\s+tools\b/i
            ];

            const HUMAN_INTENT_PATTERNS = [
                /\blooking\s+for\b/i, /\bneed\s+alternative\b/i, /\bswitching\s+from\b/i,
                /\bmoving\s+away\b/i, /\bfed\s+up\b/i, /\btoo\s+expensive\b/i,
                /\bpricing\s+issue\b/i, /\banyone\s+using\b/i, /\brecommend\b/i,
                /\brecommendation\b/i, /\bthinking\s+about\b/i, /\breplace\b/i,
                /\bmigrate\b/i, /\bmigration\b/i, /\bwhat\s+are\s+good\b/i,
                /\bexperience\s+with\b/i, /\bworth\s+it\b/i, /\bproblem\s+with\b/i,
                /\bdissatisfied\b/i, /\bfrustrated\b/i, /\bchurn\b/i
            ];

            log.info(`Scraping Reddit (via Yahoo Dorking) for: ${company}`);
            let diagSpamRejected = 0;

            for (const q of queries) {
                if (signals.length >= maxResults) break;

                const searchQuery = `site:reddit.com "${company}" ${q}`;
                const url = `https://search.yahoo.com/search?p=${encodeURIComponent(searchQuery)}&n=10`;
                
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
                        
                        // Deduplication by URL
                        if (seenUrls.has(urlPath)) return;
                        seenUrls.add(urlPath);

                        // COMMERCIAL FILTERING & SPAM GATE V2
                        const fullText = (title + " " + snippet).toLowerCase();
                        
                        // Hard Reject noise
                        if (/meme|joke|hilarious|funny|satire/i.test(fullText)) return;
                        
                        const isSeoSpam = SEO_SPAM_PATTERNS.some(r => r.test(fullText));
                        const hasHumanIntent = HUMAN_INTENT_PATTERNS.some(r => r.test(fullText));

                        if (isSeoSpam && !hasHumanIntent) {
                            diagSpamRejected++;
                            log.debug(`REDDIT_SPAM_REJECTED: ${title}`);
                            return;
                        }

                        // Must have some commercial/intent keyword to not be a generic mention
                        if (!hasHumanIntent && !/(alternatives|replacing|migration|frustrat|fed up|switch|recommendation|better than|comparison|pricing|evaluation|vs|problems)/i.test(fullText)) {
                            return; // Skip non-commercial chatter
                        }

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
                    
                    // Small delay to avoid hammering Yahoo
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (err) {
                    log.debug(`Reddit dork query failed for ${company} -> ${q}`);
                }
            }
            
            log.info(`Collected ${signals.length} high-intent Reddit posts for ${company}`);
            log.info(`REDDIT_SPAM_REJECTED [${company}]: ${diagSpamRejected}`);
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