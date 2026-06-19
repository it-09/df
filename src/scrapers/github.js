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
    // Fetch more raw items to account for aggressive noise filtering
    const perPage = Math.min(Math.max(maxResults * 3, 30), 100);
    // Cache repo star counts to avoid duplicate API calls
    const repoStarCache = new Map();

    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const companyStart = Date.now();
            log.info(`GITHUB_START [${company}]`);
            const signals = [];
            let rawCount = 0;
            try {
                // Rolling 90-day cutoff: GitHub Search API supports created:>YYYY-MM-DD filter
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - 90);
                const createdAfter = cutoffDate.toISOString().split('T')[0];
                const query = encodeURIComponent(`${company} in:title,body type:issue created:>${createdAfter}`);
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
                        if (signals.length >= maxResults) break;

                        const title = item.title || '';
                        const body = (item.body || '').substring(0, 2000);
                        const fullText = (title + " " + body).toLowerCase();
                        
                        // COMMERCIAL INTENT GATE — GitHub-specific.
                        // GitHub issues MUST show genuine buyer/evaluation context, not
                        // developer bug reports that happen to mention the company.
                        const mustContainOneOf = [
                            "alternative to", "switching from", "replacing", "moving away",
                            "too expensive", "competitor", " vs ", "versus", "pricing",
                            "recommendation", "comparison", "considering switching",
                            "better than", "canceling", "cancelling", "frustrated with",
                            "dissatisfied", "wish it had", "looking for alternative"
                        ];
                        // AGGRESSIVE NOISE REJECTION — catch dev/technical issues that
                        // mention company name but have zero buyer intent.
                        const rejectIfContains = [
                            "rebranding", "epic:", "rename:", "schema migration", "ci/cd",
                            "internal tooling", "deployment rollout", "api rate limit",
                            "bug report", "stack trace", "error:", "exception:",
                            "fix:", "feat:", "chore:", "refactor:", "test:", "docs:",
                            "pull request", "merge", "pr #", "release notes",
                            "npm install", "pip install", "yarn add", "pnpm add",
                            "sdk", "wrapper", "binding", "connector", "plugin",
                            "oauth", "auth token", "api key", "webhook", "endpoint",
                            "not implemented", "undefined method", "typeerror",
                            "mcp server", "model context protocol",
                            "changelog", "breaking change", "deprecat",
                            "unit test", "integration test", "ci pipeline",
                            "dockerfile", "kubernetes", "helm chart",
                            "implement", "add support for", "feature request"
                        ];

                        const hasCommercialIntent = mustContainOneOf.some(phrase => fullText.includes(phrase));
                        const hasTechnicalNoise = rejectIfContains.some(phrase => fullText.includes(phrase));
                        
                        if (hasTechnicalNoise || !hasCommercialIntent) {
                            continue; 
                        }

                        // Get repository stars
                        const repoFullName = item.repository_url?.split('/').slice(-2).join('/') || '';
                        let repoStars = 0;
                        
                        if (repoFullName) {
                            if (repoStarCache.has(repoFullName)) {
                                repoStars = repoStarCache.get(repoFullName);
                            } else {
                                try {
                                    const repoUrl = `https://api.github.com/repos/${repoFullName}`;
                                    const repoResponse = await axiosWithRetry({
                                        method: 'GET',
                                        url: repoUrl,
                                        headers: {
                                            'Accept': 'application/vnd.github.v3+json',
                                            'User-Agent': 'DarkFunnel-Actor/1.0'
                                        }
                                    });
                                    repoStars = repoResponse.data?.stargazers_count || 0;
                                    repoStarCache.set(repoFullName, repoStars);
                                } catch (err) {
                                    log.debug(`Failed to fetch repo data for ${repoFullName}`, { error: err.message });
                                }
                            }
                        }

                        signals.push({
                            company,
                            source: 'github',
                            title: title,
                            content: body,
                            url: item.html_url,
                            author: item.user?.login || 'unknown',
                            repository: repoFullName,
                            repoStars: repoStars,
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