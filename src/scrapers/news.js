// News API scraper module
import axios from 'axios';

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
        console.log('News API key not provided, skipping news scraping');
        return [];
    }

    const signals = [];

    for (const company of companies) {
        try {
            const query = encodeURIComponent(company);
            const url = `https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&pageSize=${maxResults}&apiKey=${apiKey}`;

            const response = await axios.get(url);

            if (response.data && response.data.articles) {
                for (const article of response.data.articles) {
                    signals.push({
                        company,
                        source: 'news',
                        title: article.title,
                        content: article.description || article.content || '',
                        url: article.url,
                        author: article.author || article.source?.name || 'unknown',
                        sourceName: article.source?.name || '',
                        createdAt: article.publishedAt,
                        scrapedAt: new Date().toISOString()
                    });
                }
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (err) {
            console.error(`News scraping error for ${company}:`, err.message);
        }
    }

    return signals;
}