// Shared HTTP utilities
import { gotScraping } from 'got-scraping';
import { log } from 'apify';

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper that mimics axios but uses got-scraping under the hood.
 * got-scraping automatically uses Apify Proxy (via process.env.APIFY_PROXY_PASSWORD),
 * generates perfect browser headers (TLS fingerprinting), and rotates them.
 * 
 * @param {Object} config - Axios-like request config
 * @param {number} retries - Number of retries (default: 3)
 * @returns {Promise} - Axios-like response object ({ data, status, headers })
 */
export async function axiosWithRetry(config, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const options = {
                url: config.url,
                method: config.method || 'GET',
                timeout: { request: 20000 },
                responseType: 'text',
                retry: { limit: 0 } // We handle our own retry logic
            };

            // Merge custom headers if any (gotScraping handles User-Agent automatically)
            if (config.headers) {
                options.headers = config.headers;
            }

            // Support form data (used by DuckDuckGo POST)
            if (config.data) {
                options.body = config.data;
            }

            const response = await gotScraping(options);

            // Mimic axios response
            let data = response.body;
            if (response.headers['content-type'] && response.headers['content-type'].includes('application/json')) {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    // ignore JSON parse error, keep as string
                }
            }

            return {
                data,
                status: response.statusCode,
                headers: response.headers
            };

        } catch (err) {
            const status = err.response ? err.response.statusCode : null;

            // Fast-fail: If the server explicitly rate-limits or blocks us, do not retry.
            // Retrying a 429/403 just wastes Apify compute time and runs up the $0.10 cost limit.
            if (status && [401, 403, 429, 503].includes(status)) {
                log.debug(`Fast-fail triggered (HTTP ${status}). Rate limited or blocked.`);
                throw err;
            }

            if (attempt === retries) throw err;
            const delay = Math.min(1500 * Math.pow(2, attempt - 1), 8000);
            log.debug(`HTTP request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`, { error: err.message });
            await sleep(delay);
        }
    }
}
