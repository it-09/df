// Unified Search Engine with Yahoo primary + Bing + DuckDuckGo fallback
import * as cheerio from 'cheerio';
import { log } from 'apify';
import { axiosWithRetry, sleep } from './http.js';

/**
 * Random jitter delay between search requests to avoid rate limiting
 * when multiple scrapers fire in parallel.
 */
async function jitter(minMs = 800, maxMs = 2500) {
    const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
    await sleep(delay);
}

/**
 * Perform a search query using Yahoo first, falling back to Bing, then DuckDuckGo.
 * Returns an array of { title, url, snippet } objects.
 * 
 * @param {string} query - The search query string
 * @param {number} maxResults - Maximum number of results to request
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
export async function searchWeb(query, maxResults = 10) {
    // Small random delay to stagger parallel scraper requests
    await jitter(500, 1500);

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

    await jitter(500, 1200);

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

    await jitter(400, 1000);

    // Final fallback: DuckDuckGo HTML search
    try {
        const results = await searchDuckDuckGo(query, maxResults);
        if (results.length > 0) {
            log.debug(`DuckDuckGo fallback returned ${results.length} results.`);
            return results;
        }
    } catch (err) {
        log.debug(`DuckDuckGo fallback also failed.`, { error: err.message });
    }

    // All failed
    log.warning(`SELECTOR_BROKEN: Yahoo, Bing, and DuckDuckGo all returned 0 results. Possible rate-limiting or selector change.`);
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
 * Search using Bing (first fallback)
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

/**
 * Search using DuckDuckGo HTML interface (second fallback)
 * DDG is more lenient on rate-limiting than Yahoo/Bing
 */
async function searchDuckDuckGo(query, maxResults) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axiosWithRetry({
        method: 'POST',
        url: 'https://html.duckduckgo.com/html/',
        data: `q=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const $ = cheerio.load(response.data);

    const results = [];
    $('.result').each((i, el) => {
        if (results.length >= maxResults) return;

        const title = $(el).find('.result__title').text().trim();
        let resultUrl = $(el).find('.result__url').text().trim();
        if (!resultUrl) resultUrl = $(el).find('a.result__a').attr('href') || '';
        // DDG tracking links — extract real URL
        if (resultUrl.startsWith('//duckduckgo.com/l/')) {
            const uddMatch = resultUrl.match(/uddg=([^&]+)/);
            if (uddMatch) resultUrl = decodeURIComponent(uddMatch[1]);
        }
        const snippet = $(el).find('.result__snippet').text().trim();

        if (title && resultUrl) {
            results.push({ title, url: resultUrl, snippet });
        }
    });

    return results;
}
