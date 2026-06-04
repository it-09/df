// GitHub scraper module
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
            log.debug(`GitHub request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`, { error: err.message });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Scrape GitHub issues and discussions for company mentions
 * Uses GitHub Search API (no auth required for public repos)
 * @param {string[]} companies - Array of company names to search
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of signals
 */
export async function scrapeGitHub(companies, maxResults = 10) {
    const perPage = Math.min(maxResults, 30); // GitHub API max per_page is 30 for search

    // M1: Parallelize across companies
    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const companyStart = Date.now();
            log.info(`GITHUB_START [${company}]`);
            const signals = [];
            let rawCount = 0;
            try {
                const query = encodeURIComponent(`${company} in:title,body type:issue`);
                const url = `https://api.github.com/search/issues?q=${query}&sort=created&order=desc&per_page=${perPage}`;

                const response = await axiosWithRetry({
                    method: 'GET',
                    url,
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'DarkFunnel-Actor/1.0'
                    }
                });

                if (response.data && response.data.items) {
                    rawCount = response.data.items.length;
                    for (const item of response.data.items) {
                        const title = item.title || '';
                        const body = (item.body || '').substring(0, 2000);
                        const fullText = (title + " " + body).toLowerCase();
                        
                        // AGGRESSIVE TECHNICAL NOISE FILTERING
                        const mustContainOneOf = [
                            "alternative", "switching", "replace", "moving away", "too expensive",
                            "competitor", "vs", "pricing", "recommendation", "looking for"
                        ];
                        const rejectIfContains = [
                            "rebranding", "migration plan", "epic", "rename", "schema", "ci/cd",
                            "bug", "refactor", "infrastructure", "internal tooling", "bronze",
                            "pipeline", "deployment", "api failure"
                        ];

                        const hasCommercialIntent = mustContainOneOf.some(phrase => new RegExp(`\\b${phrase}\\b`, 'i').test(fullText));
                        const hasTechnicalNoise = rejectIfContains.some(phrase => new RegExp(`\\b${phrase}\\b`, 'i').test(fullText));
                        
                        // STRICT GATE: GitHub MUST contain strong commercial language AND must NOT contain hard-reject noise.
                        if (hasTechnicalNoise || !hasCommercialIntent) {
                            continue; 
                        }

                        signals.push({
                            company,
                            source: 'github',
                            title: title,
                            content: body,
                            url: item.html_url,
                            author: item.user?.login || 'unknown',
                            repository: item.repository_url?.split('/').slice(-2).join('/') || '',
                            createdAt: item.created_at,
                            scrapedAt: new Date().toISOString()
                        });
                    }
                }
            } catch (err) {
                log.warning(`GitHub scraping error for ${company}`, { error: err.message });
            }
            log.info(`GITHUB_RAW [${company}]: ${rawCount}`);
            log.info(`GITHUB_FILTERED [${company}]: ${signals.length}`);
            const companyDuration = Date.now() - companyStart;
            log.info(`GITHUB_END [${company}]`);
            log.info(`GITHUB_DURATION_MS [${company}]: ${companyDuration}`);
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