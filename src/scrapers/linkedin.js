import { log } from 'apify';
import { searchWeb } from '../utils/searchEngine.js';
import { parseOrEstimatePostDate } from '../utils/normalizer.js';

// LINKEDIN COMMERCIAL GATING V4 — STRICT ALLOW/DENY SYSTEM
const DENY_PATTERNS = [
    /\bhow\s+to\b/i, /\bguide\b/i, /\btips\b/i, /\bbest\s+practices\b/i,
    /\badoption\b/i, /\blaunch\b/i, /\bfunding\b/i, /\bhiring\b/i,
    /\bcareer\b/i, /\bthought\s+leadership\b/i, /\bwhy\s+companies\b/i,
    /\bmarketing\s+strategy\b/i, /\bgrowth\s+tips\b/i, /\bindustry\s+trends\b/i,
    /\bAI\s+trend/i, /\bannouncement\b/i, /\bjob\s+opening\b/i,
    /\bwe\s+are\s+hiring\b/i, /\bcompany\s+announcement\b/i, /\bproduct\s+launch\b/i,
    /\bemployee\s+celebration\b/i, /\bfundraising\b/i, /\beducational\b/i,
    /\btop\s+\d+\b/i, /\bbest\s+.*alternative/i,
    /\branking\b/i, /\blist\s+of\b/i, /\bsoftware\s+like\b/i,
    /\balternative\s+tools\b/i, /\bmarket\s+share\b/i
];

const ALLOW_PATTERNS = [
    /\balternatives\b/i, /\bswitching\s+from\b/i, /\bmoving\s+away\b/i,
    /\bfrustrated\b/i, /\bfed\s+up\b/i, /\btoo\s+expensive\b/i,
    /\bpricing\b/i, /\brenewal\b/i, /\brecommend\b/i,
    /\brecommendation\b/i, /\bcomparison\b/i, /\bvs\b/i,
    /\breplace\b/i, /\breplacement\b/i, /\bmigration\b/i,
    /\bbetter\s+than\b/i, /\bneed\s+a\s+new\b/i, /\bwhat\s+should\s+we\s+use\b/i,
    /\bwhat\s+CRM\b/i, /\banyone\s+using\b/i, /\bexperience\s+with\b/i,
    /\bleaving\b/i, /\bcancelled\b/i, /\blooking\s+for\b/i,
    /\bneed\s+alternative\b/i, /\bpricing\s+issue\b/i,
    /\bthinking\s+about\b/i, /\bmigrate\b/i, /\bwhat\s+are\s+good\b/i,
    /\bworth\s+it\b/i, /\bproblem\s+with\b/i, /\bdissatisfied\b/i,
    /\bchurn\b/i
];

/**
 * Scrape LinkedIn posts using Yahoo/Bing Search Dorking.
 * Zero API keys required.
 * 
 * @param {string[]} companies - Companies to search for
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of LinkedIn signals
 */
export async function scrapeLinkedIn(companies, maxResults = 10) {
    // Rolling 90-day window — force search engines to return recent posts only
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const afterFilter = `after:${cutoffDate.toISOString().split('T')[0]}`;

    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const companyStart = Date.now();
            log.info(`LINKEDIN_START [${company}]`);
            const signals = [];
            const seenUrls = new Set();
            
            // Buyer-voice queries: specific to active evaluation behaviour, not thought-leadership.
            // All queries include afterFilter to force recency.
            const queries = [
                `site:linkedin.com/posts "switching from ${company}" ${afterFilter}`,
                `site:linkedin.com/posts "moving away from ${company}" ${afterFilter}`,
                `site:linkedin.com/posts "${company}" "too expensive" OR "pricing" ${afterFilter}`,
                `site:linkedin.com/posts "${company}" "looking for alternative" ${afterFilter}`,
                `site:linkedin.com/posts "${company}" "frustrated" OR "fed up" ${afterFilter}`,
                `site:linkedin.com/posts "${company}" alternative ${afterFilter}`,
                `site:linkedin.com/feed/update "switching from ${company}" ${afterFilter}`,
                `site:linkedin.com/feed/update "${company}" pricing alternative ${afterFilter}`,
                `site:linkedin.com/posts crm recommendation ${afterFilter}`,
                `site:linkedin.com/posts "looking for crm" OR "need crm" ${afterFilter}`
            ];

            log.info(`Scraping LinkedIn (via Search Dorking) for: ${company} (last 90 days)`);
            
            let diagRawResults = 0;
            let diagNoiseRejected = 0;
            let diagCommercialPass = 0;
            let diagLowConfidence = 0;

            for (const q of queries) {
                if (signals.length >= maxResults) break;

                try {
                    const searchResults = await searchWeb(q, 10);

                    for (const result of searchResults) {
                        diagRawResults++;
                        if (signals.length >= maxResults) break;
                        
                        const title = result.title;
                        const urlPath = result.url;
                        const snippet = result.snippet;

                        // Skip non-post pages
                        if (!urlPath.includes('/posts/') && !urlPath.includes('/feed/update/')) {
                            continue;
                        }
                        if (!title && !snippet) {
                            continue;
                        }

                        // Deduplication by URL
                        if (seenUrls.has(urlPath)) {
                            continue;
                        }
                        seenUrls.add(urlPath);

                        // Extract author from title
                        let author = 'LinkedIn User';
                        const authorMatch = title.match(/^(.*?)(?:\s+on\s+LinkedIn|\s+[-–—]\s+LinkedIn)/i);
                        if (authorMatch && authorMatch[1]) {
                            author = authorMatch[1].trim();
                        }

                        // Extract job title from snippet if present
                        let detectedRole = null;
                        const roleMatch = snippet.match(/(?:^|\s)((?:CEO|CTO|VP|Director|Head|Manager|Lead|Founder|Co-Founder|Chief|RevOps|Sales Ops|Marketing Ops|GTM)[^.;,]*?)(?:\s+at\s+|\s+@\s+|\s+of\s+)/i);
                        if (roleMatch) {
                            detectedRole = roleMatch[1].trim();
                        }

                        const fullText = (title + " " + snippet).toLowerCase();

                        // STRICT LINKEDIN COMMERCIAL GATING V4
                        const hasDenyPattern = DENY_PATTERNS.some(r => r.test(fullText));
                        const hasCommercialIntent = ALLOW_PATTERNS.some(r => r.test(fullText));

                        if (hasDenyPattern && !hasCommercialIntent) {
                            diagNoiseRejected++;
                            log.debug(`LINKEDIN_NOISE_REJECTED: ${title}`);
                            continue;
                        }

                        if (hasCommercialIntent) {
                            diagCommercialPass++;
                        } else {
                            diagLowConfidence++;
                            log.debug(`LINKEDIN_LOW_CONFIDENCE: ${title}`);
                            continue;
                        }

                        signals.push({
                            company,
                            source: 'linkedin',
                            title: title || `LinkedIn Post: ${company}`,
                            content: snippet,
                            url: urlPath,
                            author,
                            sourceCategory: 'linkedin_posts',
                            detectedRole: detectedRole,
                            ...parseOrEstimatePostDate(snippet, urlPath, 'linkedin'),
                            scrapedAt: new Date().toISOString()
                        });
                    }
                    
                    // Small delay between queries
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (err) {
                    log.debug(`LinkedIn dork query failed for ${company} -> ${q}`);
                }
            }

            if (process.env.DEBUG_MODE === 'true') {
                log.info(`LINKEDIN_RAW [${company}]: ${diagRawResults}`);
                log.info(`LINKEDIN_NOISE_REJECTED [${company}]: ${diagNoiseRejected}`);
                log.info(`LINKEDIN_COMMERCIAL_PASS [${company}]: ${diagCommercialPass}`);
                log.info(`LINKEDIN_LOW_CONFIDENCE [${company}]: ${diagLowConfidence}`);
                log.info(`LINKEDIN_FILTERED [${company}]: ${signals.length}`);
                const companyDuration = Date.now() - companyStart;
                log.info(`LINKEDIN_END [${company}]`);
                log.info(`LINKEDIN_DURATION_MS [${company}]: ${companyDuration}`);
                log.info(`LINKEDIN_FINAL [${company}]: ${signals.length}`);
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
