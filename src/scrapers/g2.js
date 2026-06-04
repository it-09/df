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
            log.debug(`G2 request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`, { error: err.message });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Scrape G2 reviews using Yahoo Search Dorking.
 * Yahoo Search is extremely permissive with bots and datacenter IPs compared to Google/DDG.
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

            // Dorking Yahoo for G2 reviews (expanded for dissatisfaction)
            const searchQuery = `site:g2.com/products/ "${company}" review (dislike OR alternative OR expensive OR slow OR pricing OR comparison OR missing feature OR frustrated)`;
            const url = `https://search.yahoo.com/search?p=${encodeURIComponent(searchQuery)}&n=${Math.min(maxResults + 5, 20)}`;
            
            log.info(`Scraping G2 Reviews (via Yahoo Dorking) for: ${company}`);

            try {
                const response = await axiosWithRetry({ method: 'GET', url });
                const $ = cheerio.load(response.data);

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

                $('.algo').each((i, el) => {
                    diagRawResults++;
                    if (signals.length >= maxResults) return;

                    const title = $(el).find('h3').text().trim();
                    let urlPath = $(el).find('a').first().attr('href') || '';
                    const ruMatch = urlPath.match(/\/RU=([^/]+)/);
                    if (ruMatch) urlPath = decodeURIComponent(ruMatch[1]);

                    const snippet = $(el).find('.compText').text().trim() || $(el).find('.fz-ms').text().trim();
                    const fullText = (title + " " + snippet).toLowerCase();

                    if (!title.toLowerCase().includes('review') && !snippet.toLowerCase().includes('review')) {
                        diagFilteredSignals++;
                        return;
                    }
                    if (urlPath.includes('/compare/') || urlPath.includes('/category/')) {
                        diagFilteredSignals++;
                        return;
                    }

                    // COMMERCIAL INTENT GATE V2
                    const isSeoSpam = SEO_SPAM_PATTERNS.some(r => r.test(fullText));
                    const hasHumanIntent = HUMAN_INTENT_PATTERNS.some(r => r.test(fullText));

                    if (isSeoSpam && !hasHumanIntent) {
                        diagSpamRejected++;
                        log.debug(`G2_SPAM_REJECTED: ${title}`);
                        return;
                    }

                    // Ensure dissatisfaction or comparison markers exist
                    const hasDissatisfaction = /(pricing|expensive|too expensive|alternatives|comparison|vs|limitations|wish it had|missing feature|moving away|frustrated|support issues)/i.test(fullText);
                    if (!hasHumanIntent && !hasDissatisfaction) {
                        diagFilteredSignals++;
                        return;
                    }

                    signals.push({
                        company,
                        source: 'g2',
                        title: title || `G2 Review: ${company}`,
                        content: snippet || '',
                        url: urlPath || `https://www.g2.com/products/${company.toLowerCase()}/reviews`,
                        author: 'G2 Reviewer',
                        subreddit: 'g2_reviews',
                        createdAt: new Date().toISOString(),
                        scrapedAt: new Date().toISOString()
                    });
                });

                log.info(`G2_RAW [${company}]: ${diagRawResults}`);
                log.info(`G2_SPAM_REJECTED [${company}]: ${diagSpamRejected}`);
                log.info(`G2_AFTER_FILTER [${company}]: ${diagRawResults - diagFilteredSignals - diagSpamRejected}`);
                log.info(`G2_FINAL [${company}]: ${signals.length}`);
            } catch (err) {
                log.warning(`G2 scraping failed for ${company}`, { error: err.message });
            }

            log.info(`G2_FILTERED [${company}]: ${signals.length}`);
            const companyDuration = Date.now() - companyStart;
            log.info(`G2_END [${company}]`);
            log.info(`G2_DURATION_MS [${company}]: ${companyDuration}`);

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
