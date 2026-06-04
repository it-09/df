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
            const companyStart = Date.now();
            log.info(`HN_START [${company}]`);
            const signals = [];
            const query = encodeURIComponent(company);
            let diagRawResults = 0;
            let diagFilteredSignals = 0;
            let diagSpamRejected = 0;

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

            try {
                // Search stories
                const storiesUrl = `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&hitsPerPage=${hitsPerPage}`;
                const response = await axiosWithRetry({ method: 'GET', url: storiesUrl });

                if (response.data && response.data.hits) {
                    for (const hit of response.data.hits) {
                        diagRawResults++;
                        const title = hit.title || '';
                        const content = stripHtml(hit.story_text || hit.comment_text || '').substring(0, 2000);
                        const fullText = (title + " " + content).toLowerCase();

                        // REJECT: technical architecture, open-source debates, benchmarking, engineering implementation noise
                        const hasNoise = /(architecture|open-source|benchmarking|implementation|stack trace|ci\/cd|deployment|bug|issue|refactor)/i.test(fullText);
                        if (hasNoise) {
                            diagFilteredSignals++;
                            continue;
                        }

                        // COMMERCIAL INTENT GATE V2
                        const isSeoSpam = SEO_SPAM_PATTERNS.some(r => r.test(fullText));
                        const hasHumanIntent = HUMAN_INTENT_PATTERNS.some(r => r.test(fullText));

                        if (isSeoSpam && !hasHumanIntent) {
                            diagSpamRejected++;
                            log.debug(`HN_SPAM_REJECTED: ${title}`);
                            continue;
                        }

                        // ALLOW ONLY: commercial/evaluation threads
                        const hasCommercial = /(recommendation|alternatives|comparison|migration|tooling decision|vendor evaluation|pricing|vs)/i.test(fullText);
                        if (!hasHumanIntent && !hasCommercial) {
                            diagFilteredSignals++;
                            continue;
                        }

                        signals.push({
                            company,
                            source: 'hackernews',
                            title,
                            content,
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
                        diagRawResults++;
                        const title = `Comment on: ${hit.story_title || 'HN Thread'}`;
                        const content = stripHtml(hit.comment_text || '').substring(0, 2000);
                        const fullText = (title + " " + content).toLowerCase();

                        const hasNoise = /(architecture|open-source|benchmarking|implementation|stack trace|ci\/cd|deployment|bug|issue|refactor)/i.test(fullText);
                        if (hasNoise) {
                            diagFilteredSignals++;
                            continue;
                        }

                        // COMMERCIAL INTENT GATE V2
                        const isSeoSpam = SEO_SPAM_PATTERNS.some(r => r.test(fullText));
                        const hasHumanIntent = HUMAN_INTENT_PATTERNS.some(r => r.test(fullText));

                        if (isSeoSpam && !hasHumanIntent) {
                            diagSpamRejected++;
                            log.debug(`HN_SPAM_REJECTED: ${title}`);
                            continue;
                        }

                        const hasCommercial = /(recommendation|alternatives|comparison|migration|tooling decision|vendor evaluation|pricing|vs)/i.test(fullText);
                        if (!hasHumanIntent && !hasCommercial) {
                            diagFilteredSignals++;
                            continue;
                        }

                        signals.push({
                            company,
                            source: 'hackernews',
                            title,
                            content,
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

            log.info(`HN_RAW [${company}]: ${diagRawResults}`);
            log.info(`HN_SPAM_REJECTED [${company}]: ${diagSpamRejected}`);
            log.info(`HN_AFTER_FILTER [${company}]: ${diagRawResults - diagFilteredSignals - diagSpamRejected}`);
            log.info(`HN_FILTERED [${company}]: ${signals.length}`);
            const companyDuration = Date.now() - companyStart;
            log.info(`HN_END [${company}]`);
            log.info(`HN_DURATION_MS [${company}]: ${companyDuration}`);
            log.info(`HN_FINAL [${company}]: ${signals.length}`);

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