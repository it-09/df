// Unified Search Engine with Yahoo primary + Bing fallback
import * as cheerio from 'cheerio';
import { log } from 'apify';
import { axiosWithRetry } from './http.js';

/**
 * Perform a search query using Yahoo first, falling back to Bing if Yahoo returns no results.
 * Returns an array of { title, url, snippet } objects.
 * 
 * @param {string} query - The search query string
 * @param {number} maxResults - Maximum number of results to request
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
export async function searchWeb(query, maxResults = 10) {
    // Try Yahoo first
    try {
        const results = await searchYahoo(query, maxResults);
        if (results.length > 0) {
            return results;
        }
        log.debug(`Yahoo returned 0 results for query, trying Bing fallback...`);
    } catch (err) {
        log.debug(`Yahoo search failed, trying Bing fallback...`, { error: err.message });
    }

    // Fallback to Bing
    try {
        const results = await searchBing(query, maxResults);
        if (results.length > 0) {
            log.debug(`Bing fallback returned ${results.length} results.`);
            return results;
        }
    } catch (err) {
        log.debug(`Bing fallback also failed.`, { error: err.message });
    }

    // Both failed
    log.warning(`SELECTOR_BROKEN: Both Yahoo and Bing returned 0 results for query. Search engine HTML may have changed.`);
    return [];
}

/**
 * Search using Yahoo
 */
async function searchYahoo(query, maxResults) {
    const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}&n=${Math.min(maxResults + 5, 20)}`;
    const response = await axiosWithRetry({ method: 'GET', url });
    const $ = cheerio.load(response.data);

    const results = [];
    $('.algo').each((i, el) => {
        if (results.length >= maxResults) return;

        const title = $(el).find('h3').text().trim();
        let resultUrl = $(el).find('a').first().attr('href') || '';

        // Extract actual URL from Yahoo tracking link
        const ruMatch = resultUrl.match(/\/RU=([^/]+)/);
        if (ruMatch) resultUrl = decodeURIComponent(ruMatch[1]);

        const snippet = $(el).find('.compText').text().trim() || $(el).find('.fz-ms').text().trim();

        if (title || snippet) {
            results.push({ title, url: resultUrl, snippet });
        }
    });

    return results;
}

/**
 * Search using Bing (fallback)
 */
async function searchBing(query, maxResults) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults + 5, 20)}`;
    const response = await axiosWithRetry({ method: 'GET', url });
    const $ = cheerio.load(response.data);

    const results = [];
    $('#b_results .b_algo').each((i, el) => {
        if (results.length >= maxResults) return;

        const title = $(el).find('h2').text().trim();
        const resultUrl = $(el).find('h2 a').attr('href') || '';
        const snippet = $(el).find('.b_caption p').text().trim();

        if (title || snippet) {
            results.push({ title, url: resultUrl, snippet });
        }
    });

    return results;
}
