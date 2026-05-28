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
            const signals = [];
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
                    for (const item of response.data.items) {
                        signals.push({
                            company,
                            source: 'github',
                            title: item.title,
                            content: (item.body || '').substring(0, 2000),
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