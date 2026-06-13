// News API scraper module
import { log } from 'apify';
import { axiosWithRetry } from '../utils/http.js';

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

    const pageSize = Math.min(maxResults, 100);

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
                            dateSource: 'actual',
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

    const allSignals = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            allSignals.push(...result.value);
        }
    }

    return allSignals;
}