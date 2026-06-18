import { log } from 'apify';
import { searchWeb } from '../utils/searchEngine.js';
import { parseOrEstimatePostDate } from '../utils/normalizer.js';
import { isSeoSpamLight, hasHumanIntent } from '../utils/spamPatterns.js';

/**
 * Scrape G2 reviews using Yahoo/Bing Search Dorking.
 * Zero API keys required.
 * 
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of G2 signals
 */
export async function scrapeG2(companies, maxResults = 10) {
    // Rolling 90-day window — G2 reviews indexed in search engines respect after: filter
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const afterFilter = `after:${cutoffDate.toISOString().split('T')[0]}`;

    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const companyStart = Date.now();
            log.info(`G2_START [${company}]`);
            const signals = [];

            // Multiple targeted queries — G2 reviews are highest-intent signals (1.6x score multiplier).
            // Cast a wide net across different review intents.
            const queries = [
                `site:g2.com "${company}" (dislike OR alternative OR expensive OR pricing OR "missing feature" OR frustrated OR "wish it had" OR limitations OR switching OR canceling) ${afterFilter}`,
                `site:g2.com "${company}" review 2025 OR 2026 ${afterFilter}`,
                `site:g2.com "${company}" "cons" OR "what I dislike" ${afterFilter}`
            ];

            log.info(`Scraping G2 Reviews (via Search Dorking) for: ${company} (last 90 days)`);

            let diagRawResults = 0;
            let diagFilteredSignals = 0;
            let diagSpamRejected = 0;

            for (const searchQuery of queries) {
                if (signals.length >= maxResults) break;
                try {
                    const searchResults = await searchWeb(searchQuery, Math.ceil((maxResults + 5) / queries.length));

                    for (const result of searchResults) {
                        diagRawResults++;
                        if (signals.length >= maxResults) break;

                        const title = result.title;
                        const urlPath = result.url;
                        const snippet = result.snippet;
                        const fullText = (title + " " + snippet).toLowerCase();

                        // Skip category/compare pages (not individual reviews)
                        if (urlPath.includes('/category/')) {
                            diagFilteredSignals++;
                            continue;
                        }

                        // LIGHT spam gate — only catch obvious listicles
                        const isSpam = isSeoSpamLight(fullText);
                        const hasIntent = hasHumanIntent(fullText);

                        if (isSpam && !hasIntent) {
                            diagSpamRejected++;
                            log.debug(`G2_SPAM_REJECTED: ${title}`);
                            continue;
                        }

                        // Primary gate: any dissatisfaction, evaluation or comparison signal
                        const hasDissatisfaction = /(pricing|expensive|too expensive|alternative|comparison|vs\b|versus|limitations|wish it had|missing feature|moving away|frustrated|support issues|dislike|canceling|cancelling|switching|slow|buggy|confusing|overpriced)/i.test(fullText);
                        if (!hasIntent && !hasDissatisfaction) {
                            diagFilteredSignals++;
                            continue;
                        }

                        signals.push({
                            company,
                            source: 'g2',
                            title: title || `G2 Review: ${company}`,
                            content: snippet || '',
                            url: urlPath || `https://www.g2.com/products/${encodeURIComponent(company.toLowerCase())}/reviews`,
                            author: 'G2 Reviewer',
                            sourceCategory: 'g2_reviews',
                            ...parseOrEstimatePostDate(snippet, urlPath, 'g2'),
                            scrapedAt: new Date().toISOString()
                        });
                    }
                } catch (err) {
                    log.warning(`G2 scraping failed for ${company}`, { error: err.message });
                }
            } // end for queries

            if (process.env.DEBUG_MODE === 'true') {
                log.info(`G2_RAW [${company}]: ${diagRawResults}`);
                log.info(`G2_SPAM_REJECTED [${company}]: ${diagSpamRejected}`);
                log.info(`G2_AFTER_FILTER [${company}]: ${diagRawResults - diagFilteredSignals - diagSpamRejected}`);
                log.info(`G2_FILTERED [${company}]: ${signals.length}`);
                const companyDuration = Date.now() - companyStart;
                log.info(`G2_END [${company}]`);
                log.info(`G2_DURATION_MS [${company}]: ${companyDuration}`);
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
