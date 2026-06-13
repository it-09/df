import { log } from 'apify';
import { searchWeb } from '../utils/searchEngine.js';
import { parseOrEstimatePostDate } from '../utils/normalizer.js';
import { isSeoSpam, hasHumanIntent } from '../utils/spamPatterns.js';

/**
 * Scrape Reddit posts using Yahoo/Bing Search Dorking.
 * Zero API keys required.
 * 
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of Reddit signals
 */
export async function scrapeReddit(companies, maxResults = 10) {
    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const companyStart = Date.now();
            log.info(`REDDIT_START [${company}]`);
            const signals = [];
            const seenUrls = new Set();
            
            const queries = [
                `alternatives`, `vs`, `pricing`, `problems`, 
                `migration`, `replacing`, `"fed up"`, `recommendation`
            ];

            let diagSpamRejected = 0;

            log.info(`Scraping Reddit (via Search Dorking) for: ${company}`);

            for (const q of queries) {
                if (signals.length >= maxResults) break;

                const searchQuery = `site:reddit.com "${company}" ${q}`;
                
                try {
                    const searchResults = await searchWeb(searchQuery, 10);

                    for (const result of searchResults) {
                        if (signals.length >= maxResults) break;
                        
                        const title = result.title;
                        const urlPath = result.url;
                        const snippet = result.snippet;

                        if (!urlPath.includes('/comments/')) continue;
                        if (!title && !snippet) continue;
                        
                        // Deduplication by URL
                        if (seenUrls.has(urlPath)) continue;
                        seenUrls.add(urlPath);

                        // COMMERCIAL FILTERING & SPAM GATE
                        const fullText = (title + " " + snippet).toLowerCase();
                        
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
                            ...parseOrEstimatePostDate(snippet, urlPath, 'reddit'),
                            scrapedAt: new Date().toISOString()
                        });
                    }
                    
                    // Small delay between queries
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (err) {
                    log.debug(`Reddit dork query failed for ${company} -> ${q}`);
                }
            }
            
            log.info(`Collected ${signals.length} high-intent Reddit posts for ${company}`);
            if (process.env.DEBUG_MODE === 'true') {
                log.info(`REDDIT_SPAM_REJECTED [${company}]: ${diagSpamRejected}`);
                log.info(`REDDIT_RAW [${company}]: ${seenUrls.size}`);
                log.info(`REDDIT_FILTERED [${company}]: ${signals.length}`);
                const companyDuration = Date.now() - companyStart;
                log.info(`REDDIT_END [${company}]`);
                log.info(`REDDIT_DURATION_MS [${company}]: ${companyDuration}`);
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