// Unified Search Engine with Yahoo primary + Bing + DuckDuckGo fallback
import * as cheerio from 'cheerio';
import { log } from 'apify';
import { axiosWithRetry, sleep } from './http.js';

/**
 * Global circuit breaker to track search engine rate-limiting.
 * If an engine fails consecutively, we stop using it to prevent retry storms
 * that waste Apify compute time and trigger the $0.10 cost limit.
 */
const engineHealth = {
    yahoo: { consecutiveFailures: 0, isDead: false },
    bing: { consecutiveFailures: 0, isDead: false },
    ddg: { consecutiveFailures: 0, isDead: false }
};

const FAILURE_THRESHOLD = 3;

function recordFailure(engine) {
    engineHealth[engine].consecutiveFailures++;
    if (engineHealth[engine].consecutiveFailures >= FAILURE_THRESHOLD) {
        engineHealth[engine].isDead = true;
        log.warning(`CIRCUIT BREAKER OPEN: ${engine.toUpperCase()} is DEAD (rate limited). Skipping for rest of run.`);
    }
}

function recordSuccess(engine) {
    engineHealth[engine].consecutiveFailures = 0;
}

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
    // Check if ALL engines are dead
    if (engineHealth.yahoo.isDead && engineHealth.bing.isDead && engineHealth.ddg.isDead) {
        log.warning(`ALL ENGINES DEAD: Circuit breaker open for all search engines. Cannot fetch query: ${query}`);
        return [];
    }

    // Small random delay to stagger parallel scraper requests
    await jitter(500, 1500);

    // Try Yahoo first
    if (!engineHealth.yahoo.isDead) {
        try {
            const results = await searchYahoo(query, maxResults);
            if (results.length > 0) {
                recordSuccess('yahoo');
                return results;
            }
            log.debug(`Yahoo returned 0 results for query, trying Bing fallback...`);
            recordFailure('yahoo'); // 0 results is often a silent rate-limit / CAPTCHA page
        } catch (err) {
            log.debug(`Yahoo search failed, trying Bing fallback...`, { error: err.message });
            recordFailure('yahoo');
        }
    }

    // Fallback to Bing
    if (!engineHealth.bing.isDead) {
        await jitter(500, 1200);
        try {
            const results = await searchBing(query, maxResults);
            if (results.length > 0) {
                log.debug(`Bing fallback returned ${results.length} results.`);
                recordSuccess('bing');
                return results;
            }
            recordFailure('bing');
        } catch (err) {
            log.debug(`Bing fallback also failed.`, { error: err.message });
            recordFailure('bing');
        }
    }

    // Final fallback: DuckDuckGo HTML search
    if (!engineHealth.ddg.isDead) {
        await jitter(400, 1000);
        try {
            const results = await searchDuckDuckGo(query, maxResults);
            if (results.length > 0) {
                log.debug(`DuckDuckGo fallback returned ${results.length} results.`);
                recordSuccess('ddg');
                return results;
            }
            recordFailure('ddg');
        } catch (err) {
            log.debug(`DuckDuckGo fallback also failed.`, { error: err.message });
            recordFailure('ddg');
        }
    }

    // All failed
    log.warning(`SELECTOR_BROKEN or RATE_LIMITED: Yahoo, Bing, and DuckDuckGo failed to return results.`);
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
