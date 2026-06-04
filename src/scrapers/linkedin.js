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
                `site:linkedin.com/posts "${company}" alternatives`,
                `site:linkedin.com/posts "${company}" recommendation`,
                `site:linkedin.com/posts "${company}" pricing`,
                `site:linkedin.com/posts "${company}" vs`,
                `site:linkedin.com/posts "${company}" switching`,
                `site:linkedin.com/posts CRM recommendation`,
                `site:linkedin.com/posts sales stack`,
                `site:linkedin.com/posts marketing automation alternatives`,
                `site:linkedin.com/posts GTM stack`,
                `site:linkedin.com/posts revops tools`
            ];

            log.info(`Scraping LinkedIn (via Yahoo Dorking) for: ${company}`);
            
            let diagRawResults = 0;
            let diagParsedUrls = 0;
            let diagFilteredSignals = 0;

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

                        // NOISE REJECTION: Hard reject fluffy/hiring/corporate posts
                        const isNoise = /(hiring|job opening|we are hiring|conference|event|webinar|company announcement|product launch|employee celebration|fundraising|thought leadership fluff)/i.test(fullText);
                        if (isNoise) {
                            diagFilteredSignals++;
                            return;
                        }

                        // COMMERCIAL BOOST: Must have commercial intent to be a quality signal (optional strict gate depending on needs, but we'll score it implicitly by keeping it)
                        const hasCommercial = /(recommendation|alternatives|switching|moving away|replace|vendor|evaluation|pricing|CRM stack|sales stack|pain|frustrated|procurement|tool selection)/i.test(fullText);
                        if (!hasCommercial) {
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

            log.info(`LinkedIn Forensic Debug [${company}]:`);
            log.info(`LinkedIn raw Yahoo results: ${diagRawResults}`);
            log.info(`LinkedIn parsed URLs: ${diagParsedUrls}`);
            log.info(`LinkedIn filtered signals: ${diagFilteredSignals}`);
            log.info(`LinkedIn final candidates: ${signals.length}`);

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
