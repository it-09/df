// GitHub scraper module
import { log } from 'apify';
import { axiosWithRetry } from '../utils/http.js';

/**
 * Scrape GitHub issues and discussions for company mentions
 * Uses GitHub Search API (no auth required for public repos)
 * @param {string[]} companies - Array of company names to search
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of signals
 */
export async function scrapeGitHub(companies, maxResults = 10) {
    const perPage = Math.min(maxResults, 30);

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
                        
                        // COMMERCIAL INTENT GATE - require at least one buying signal
                        const mustContainOneOf = [
                            "alternative", "switching", "replace", "moving away", "too expensive",
                            "competitor", " vs ", "versus", "pricing", "recommendation", "looking for",
                            "comparison", "evaluation", "considering", "better than", "migrate",
                            "canceling", "cancelling", "frustrated", "dissatisfied", "wish it had",
                            "limitation", "problem with", "issue with"
                        ];
                        const rejectIfContains = [
                            "rebranding", "epic:", "rename:", "schema migration", "ci/cd pipeline",
                            "internal tooling", "deployment rollout", "api rate limit"
                        ];

                        const hasCommercialIntent = mustContainOneOf.some(phrase => fullText.includes(phrase));
                        const hasTechnicalNoise = rejectIfContains.some(phrase => fullText.includes(phrase));
                        
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
                            dateSource: 'actual',
                            scrapedAt: new Date().toISOString()
                        });
                    }
                }
            } catch (err) {
                log.warning(`GitHub scraping error for ${company}`, { error: err.message });
            }
            if (process.env.DEBUG_MODE === 'true') {
                log.info(`GITHUB_RAW [${company}]: ${rawCount}`);
                log.info(`GITHUB_FILTERED [${company}]: ${signals.length}`);
                const companyDuration = Date.now() - companyStart;
                log.info(`GITHUB_END [${company}]`);
                log.info(`GITHUB_DURATION_MS [${company}]: ${companyDuration}`);
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