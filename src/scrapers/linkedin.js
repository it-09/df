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
            let diagParsedUrls = 0;
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
                            diagFilteredSignals++;
                            return;
                        }
                        if (!title && !snippet) {
                            diagFilteredSignals++;
                            return;
                        }
                        diagParsedUrls++;

                        // Deduplication by URL
                        if (seenUrls.has(urlPath)) {
                            diagFilteredSignals++;
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

                        // NOISE REJECTION: Hard reject fluffy/hiring/corporate posts (slightly relaxed)
                        const isNoise = /(hiring|job opening|we are hiring|company announcement|product launch|employee celebration|fundraising)/i.test(fullText);
                        if (isNoise) {
                            diagFilteredSignals++;
                            return;
                        }

                        // COMMERCIAL INTENT GATE V2
                        const isSeoSpam = SEO_SPAM_PATTERNS.some(r => r.test(fullText));
                        const hasHumanIntent = HUMAN_INTENT_PATTERNS.some(r => r.test(fullText));

                        if (isSeoSpam && !hasHumanIntent) {
                            diagSpamRejected++;
                            log.debug(`LINKEDIN_SPAM_REJECTED: ${title}`);
                            return;
                        }

                        // COMMERCIAL BOOST: Expanded to include softer intent keywords
                        const hasCommercial = /(recommendation|alternatives|switching|moving away|replace|vendor|evaluation|pricing|CRM stack|sales stack|pain|frustrated|procurement|tool selection|recommend|evaluating|considering|experience with|thinking about switching)/i.test(fullText);
                        if (!hasHumanIntent && !hasCommercial) {
                            diagFilteredSignals++;
                            return;
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

            log.info(`LINKEDIN_RAW [${company}]: ${diagRawResults}`);
            log.info(`LINKEDIN_SPAM_REJECTED [${company}]: ${diagSpamRejected}`);
            log.info(`LINKEDIN_AFTER_FILTER [${company}]: ${diagParsedUrls - diagFilteredSignals - diagSpamRejected}`);
            log.info(`LINKEDIN_FINAL [${company}]: ${signals.length}`);

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
