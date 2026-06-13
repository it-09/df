import { log } from 'apify';
import { searchWeb } from '../utils/searchEngine.js';
import { isSeoSpam, hasHumanIntent } from '../utils/spamPatterns.js';

/**
 * Scrape G2 reviews using Yahoo/Bing Search Dorking.
 * Zero API keys required.
 * 
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of G2 signals
 */
export async function scrapeG2(companies, maxResults = 10) {
    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const companyStart = Date.now();
            log.info(`G2_START [${company}]`);
            const signals = [];

            const searchQuery = `site:g2.com/products/ "${company}" review (dislike OR alternative OR expensive OR slow OR pricing OR comparison OR missing feature OR frustrated)`;
            
            log.info(`Scraping G2 Reviews (via Search Dorking) for: ${company}`);

            try {
                const searchResults = await searchWeb(searchQuery, maxResults + 5);

                let diagRawResults = 0;
                let diagFilteredSignals = 0;
                let diagSpamRejected = 0;

                for (const result of searchResults) {
                    diagRawResults++;
                    if (signals.length >= maxResults) break;

                    const title = result.title;
                    const urlPath = result.url;
                    const snippet = result.snippet;
                    const fullText = (title + " " + snippet).toLowerCase();

                    if (!title.toLowerCase().includes('review') && !snippet.toLowerCase().includes('review')) {
                        diagFilteredSignals++;
                        continue;
                    }
                    if (urlPath.includes('/compare/') || urlPath.includes('/category/')) {
                        diagFilteredSignals++;
                        continue;
                    }

                    // COMMERCIAL INTENT GATE
                    const isSpam = isSeoSpam(fullText);
                    const hasIntent = hasHumanIntent(fullText);

                    if (isSpam && !hasIntent) {
                        diagSpamRejected++;
                        log.debug(`G2_SPAM_REJECTED: ${title}`);
                        continue;
                    }

                    // Ensure dissatisfaction or comparison markers exist
                    const hasDissatisfaction = /(pricing|expensive|too expensive|alternatives|comparison|vs|limitations|wish it had|missing feature|moving away|frustrated|support issues)/i.test(fullText);
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
                        createdAt: new Date().toISOString(),
                        dateSource: 'inferred',
                        scrapedAt: new Date().toISOString()
                    });
                }

                if (process.env.DEBUG_MODE === 'true') {
                    log.info(`G2_RAW [${company}]: ${diagRawResults}`);
                    log.info(`G2_SPAM_REJECTED [${company}]: ${diagSpamRejected}`);
                    log.info(`G2_AFTER_FILTER [${company}]: ${diagRawResults - diagFilteredSignals - diagSpamRejected}`);
                    log.info(`G2_FINAL [${company}]: ${signals.length}`);
                }
            } catch (err) {
                log.warning(`G2 scraping failed for ${company}`, { error: err.message });
            }

            if (process.env.DEBUG_MODE === 'true') {
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
