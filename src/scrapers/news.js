// News API scraper module
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
            log.debug(`News API request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`, { error: err.message });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Scrape news mentions of companies using NewsAPI.org
 * Requires API key (100 requests/day free tier)
 * @param {string[]} companies - Array of company names to search
 * @param {string} apiKey - NewsAPI.org API key
 * @param {number} maxResults - Maximum results per company
 * @returns {Promise<Array>} - Array of signals
 */
export async function scrapeNews(companies, apiKey, maxResults = 10) {
    if (!apiKey) {
        log.info('News API key not provided, skipping news scraping');
        return [];
    }

    const pageSize = Math.min(maxResults, 100); // NewsAPI max is 100

    // Parallelize across companies
    const results = await Promise.allSettled(
        companies.map(async (company) => {
            const signals = [];
            try {
                const query = encodeURIComponent(company);
                const url = `https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&pageSize=${pageSize}&apiKey=${apiKey}`;

                const response = await axiosWithRetry({ method: 'GET', url });

                if (response.data && response.data.articles) {
                    for (const article of response.data.articles) {
                        signals.push({
                            company,
                            source: 'news',
                            title: article.title,
                            content: (article.description || article.content || '').substring(0, 2000),
                            url: article.url,
                            author: article.author || article.source?.name || 'unknown',
                            sourceName: article.source?.name || '',
                            createdAt: article.publishedAt,
                            scrapedAt: new Date().toISOString()
                        });
                    }
                }
            } catch (err) {
                log.warning(`News scraping error for ${company}`, { error: err.message });
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