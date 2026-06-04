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

// ========================================================
// LINKEDIN COMMERCIAL GATING V4 — STRICT ALLOW/DENY SYSTEM
// ========================================================

const DENY_PATTERNS = [
    /\bhow\s+to\b/i, /\bguide\b/i, /\btips\b/i, /\bbest\s+practices\b/i,
    /\badoption\b/i, /\blaunch\b/i, /\bfunding\b/i, /\bhiring\b/i,
    /\bcareer\b/i, /\bthought\s+leadership\b/i, /\bwhy\s+companies\b/i,
    /\bmarketing\s+strategy\b/i, /\bgrowth\s+tips\b/i, /\bindustry\s+trends\b/i,
    /\bAI\s+trend/i, /\bannouncement\b/i, /\bjob\s+opening\b/i,
    /\bwe\s+are\s+hiring\b/i, /\bcompany\s+announcement\b/i, /\bproduct\s+launch\b/i,
    /\bemployee\s+celebration\b/i, /\bfundraising\b/i, /\beducational\b/i,
    /\btop\s+\d+\b/i, /\bbest\s+.*alternative/i, /\b2025\b/i, /\b2026\b/i,
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
            const companyStart = Date.now();
            log.info(`LINKEDIN_START [${company}]`);
            const signals = [];
            const seenUrls = new Set();
            
            const queries = [
                `site:linkedin.com/posts "${company}" alternative`,
                `site:linkedin.com/feed/update "${company}" alternative`,
                `site:linkedin.com/posts "${company}" pricing`,
                `site:linkedin.com/feed/update "${company}" pricing`,
                `site:linkedin.com/posts "switching from ${company}"`,
                `site:linkedin.com/feed/update "moving away from ${company}"`,
                `site:linkedin.com/posts crm recommendation`,
                `site:linkedin.com/feed/update crm alternatives`,
                `site:linkedin.com/posts looking for crm`,
                `site:linkedin.com/posts best crm for`
            ];

            log.info(`Scraping LinkedIn (via Yahoo Dorking) for: ${company}`);
            
            let diagRawResults = 0;
            let diagNoiseRejected = 0;
            let diagCommercialPass = 0;
            let diagLowConfidence = 0;

            for (const q of queries) {
                if (signals.length >= maxResults) break;

                const url = `https://search.yahoo.com/search?p=${encodeURIComponent(q)}&n=10`;
                
                try {
                    const response = await axiosWithRetry({ method: 'GET', url });
                    const $ = cheerio.load(response.data);

                    $('.algo').each((i, el) => {
                        diagRawResults++;
                        if (signals.length >= maxResults) return;
                        
                        const title = $(el).find('h3').text().trim();
                        let urlPath = $(el).find('a').first().attr('href') || '';
                        const ruMatch = urlPath.match(/\/RU=([^/]+)/);
                        if (ruMatch) urlPath = decodeURIComponent(ruMatch[1]);
                        
                        const snippet = $(el).find('.compText').text().trim() || $(el).find('.fz-ms').text().trim();

                        // Skip non-post pages
                        if (!urlPath.includes('/posts/') && !urlPath.includes('/feed/update/')) {
                            return;
                        }
                        if (!title && !snippet) {
                            return;
                        }

                        // Deduplication by URL
                        if (seenUrls.has(urlPath)) {
                            return;
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

                        // ============================================
                        // STRICT LINKEDIN COMMERCIAL GATING V4
                        // ============================================
                        const hasDenyPattern = DENY_PATTERNS.some(r => r.test(fullText));
                        const hasCommercialIntent = ALLOW_PATTERNS.some(r => r.test(fullText));

                        if (hasDenyPattern && !hasCommercialIntent) {
                            diagNoiseRejected++;
                            log.debug(`LINKEDIN_NOISE_REJECTED: ${title}`);
                            return;
                        }

                        if (hasCommercialIntent) {
                            diagCommercialPass++;
                        } else {
                            // No deny pattern, but also no commercial intent — low confidence
                            diagLowConfidence++;
                            log.debug(`LINKEDIN_LOW_CONFIDENCE: ${title}`);
                            return; // Skip ambiguous content
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
                    
                    // Small delay to avoid hammering Yahoo
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
