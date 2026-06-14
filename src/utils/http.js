// Shared HTTP utilities
import axios from 'axios';
import { log } from 'apify';

// Rotating user agents to reduce bot detection when parallel scrapers hit the same host
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

let uaIndex = 0;
function nextUserAgent() {
    const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
    uaIndex++;
    return ua;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for axios requests with exponential backoff
 * @param {Object} config - Axios request config
 * @param {number} retries - Number of retries (default: 3)
 * @returns {Promise} - Axios response
 */
export async function axiosWithRetry(config, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await axios({
                timeout: 20000,
                ...config,
                // Allow per-request header overrides
                headers: { ...{ 'User-Agent': nextUserAgent(), 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5' }, ...(config.headers || {}) }
            });
        } catch (err) {
            if (attempt === retries) throw err;
            const delay = Math.min(1500 * Math.pow(2, attempt - 1), 8000);
            log.debug(`HTTP request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`, { error: err.message });
            await sleep(delay);
        }
    }
}
