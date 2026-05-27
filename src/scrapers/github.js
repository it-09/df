// GitHub scraper module
import axios from 'axios';

/**
 * Scrape GitHub issues and discussions for company mentions
 * Uses GitHub Search API (no auth required for public repos)
 * @param {string[]} companies - Array of company names to search
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of signals
 */
export async function scrapeGitHub(companies, maxResults = 10) {
    const signals = [];

    for (const company of companies) {
        try {
            // Search GitHub issues mentioning the company
            const query = encodeURIComponent(`${company} in:title,body type:issue`);
            const url = `https://api.github.com/search/issues?q=${query}&sort=created&order=desc&per_page=${maxResults}`;

            const response = await axios.get(url, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'DarkFunnel-Actor'
                }
            });

            if (response.data && response.data.items) {
                for (const item of response.data.items) {
                    signals.push({
                        company,
                        source: 'github',
                        title: item.title,
                        content: item.body || '',
                        url: item.html_url,
                        author: item.user?.login || 'unknown',
                        repository: item.repository_url?.split('/').slice(-2).join('/') || '',
                        createdAt: item.created_at,
                        scrapedAt: new Date().toISOString()
                    });
                }
            }

            // Rate limiting: GitHub API allows 60 requests/hour without auth
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (err) {
            console.error(`GitHub scraping error for ${company}:`, err.message);
        }
    }

    return signals;
}