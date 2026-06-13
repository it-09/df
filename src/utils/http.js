// Shared HTTP utilities
import axios from 'axios';
import { log } from 'apify';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
                timeout: 15000,
                headers: {
                    'User-Agent': DEFAULT_USER_AGENT
                },
                ...config
            });
        } catch (err) {
            if (attempt === retries) throw err;
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            log.debug(`HTTP request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`, { error: err.message });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
