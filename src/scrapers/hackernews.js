// Hacker News scraper module
import { log } from 'apify';
import { axiosWithRetry } from '../utils/http.js';
import { isSeoSpamLight, hasHumanIntent } from '../utils/spamPatterns.js';

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
    const hitsPerPage = Math.min(maxResults, 50);

    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const companyStart = Date.now();
            log.info(`HN_START [${company}]`);
            const signals = [];
            const query = encodeURIComponent(company);
            let diagRawResults = 0;
            let diagFilteredSignals = 0;
            let diagSpamRejected = 0;

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

                        // REJECT: clear technical noise (not product evaluation)
                        const hasNoise = /(stack trace|ci\/cd|deployment pipeline|bug report|refactor sprint|internal infrastructure)/i.test(fullText);
                        if (hasNoise) {
                            diagFilteredSignals++;
                            continue;
                        }

                        // LIGHT spam gate for HN (avoids killing comparison/review content)
                        if (isSeoSpamLight(fullText) && !hasHumanIntent(fullText)) {
                            diagSpamRejected++;
                            log.debug(`HN_SPAM_REJECTED: ${title}`);
                            continue;
                        }

                        const hasCommercial = /(recommend|alternatives?|comparison|migration|tooling decision|vendor evaluation|pricing|vs\b|switching|replacing|too expensive|fed up|moving away|looking for|open.source alternative)/i.test(fullText);
                        if (!hasHumanIntent(fullText) && !hasCommercial) {
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
                            dateSource: 'actual',
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

                        // REJECT: clear technical noise
                        const hasNoise = /(stack trace|ci\/cd|deployment pipeline|bug report|refactor sprint|internal infrastructure)/i.test(fullText);
                        if (hasNoise) {
                            diagFilteredSignals++;
                            continue;
                        }

                        if (isSeoSpamLight(fullText) && !hasHumanIntent(fullText)) {
                            diagSpamRejected++;
                            log.debug(`HN_SPAM_REJECTED: ${title}`);
                            continue;
                        }

                        const hasCommercial = /(recommend|alternatives?|comparison|migration|tooling decision|vendor evaluation|pricing|vs\b|switching|replacing|too expensive|fed up|moving away|looking for|open.source alternative)/i.test(fullText);
                        if (!hasHumanIntent(fullText) && !hasCommercial) {
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
                            dateSource: 'actual',
                            scrapedAt: new Date().toISOString()
                        });
                    }
                }
            } catch (err) {
                log.warning(`HN comments error for ${company}`, { error: err.message });
            }

            if (process.env.DEBUG_MODE === 'true') {
                log.info(`HN_RAW [${company}]: ${diagRawResults}`);
                log.info(`HN_SPAM_REJECTED [${company}]: ${diagSpamRejected}`);
                log.info(`HN_AFTER_FILTER [${company}]: ${diagRawResults - diagFilteredSignals - diagSpamRejected}`);
                log.info(`HN_FILTERED [${company}]: ${signals.length}`);
                const companyDuration = Date.now() - companyStart;
                log.info(`HN_END [${company}]`);
                log.info(`HN_DURATION_MS [${company}]: ${companyDuration}`);
                log.info(`HN_FINAL [${company}]: ${signals.length}`);
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