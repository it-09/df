// Data normalization utilities

/**
 * Fuzzy match company names
 * @param {string} mention - Company mention from text
 * @param {string[]} companies - Known company names
 * @returns {string|null} - Matched company or null
 */
export function fuzzyMatchCompany(mention, companies) {
    if (!mention) return null;

    const mentionLower = mention.toLowerCase().trim();

    // Exact match first
    for (const company of companies) {
        if (mentionLower === company.toLowerCase()) {
            return company;
        }
    }

    // Partial match (company name contains mention or vice versa)
    for (const company of companies) {
        const companyLower = company.toLowerCase();
        if (mentionLower.includes(companyLower) || companyLower.includes(mentionLower)) {
            return company;
        }
    }

    // Simple Levenshtein distance for typos
    for (const company of companies) {
        const distance = levenshteinDistance(mentionLower, company.toLowerCase());
        const maxLength = Math.max(mentionLower.length, company.length);
        const similarity = 1 - (distance / maxLength);

        if (similarity > 0.8) {
            return company;
        }
    }

    return null;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];

    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    return matrix[len1][len2];
}

/**
 * Clean and normalize text
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
export function cleanText(text) {
    if (!text) return '';

    return text
        .replace(/\r\n/g, '\n')           // Normalize line breaks
        .replace(/\t/g, ' ')              // Replace tabs
        .replace(/\s+/g, ' ')             // Collapse whitespace
        .replace(/[^\x00-\x7F]/g, '')     // Remove non-ASCII (optional)
        .trim();
}

/**
 * Generate a simple hash for deduplication
 * @param {string} text - Text to hash
 * @returns {string} - Hash string
 */
export function simpleHash(text) {
    if (!text) return '';

    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

/**
 * Deduplicate signals based on content similarity
 * @param {Array} signals - Array of signal objects
 * @returns {Array} - Deduplicated signals
 */
export function deduplicateSignals(signals) {
    const seen = new Set();
    const unique = [];

    for (const signal of signals) {
        // Create a fingerprint from title + first 200 chars of content
        const fingerprint = simpleHash(
            (signal.title || '') + (signal.content || '').substring(0, 200)
        );

        if (!seen.has(fingerprint)) {
            seen.add(fingerprint);
            unique.push(signal);
        }
    }

    return unique;
}

/**
 * Calculate confidence score for a signal
 * @param {Object} signal - Signal object
 * @returns {number} - Confidence score (0-1)
 */
export function calculateConfidence(signal) {
    let score = 0.5; // Base score

    // Boost for having both title and content
    if (signal.title && signal.content && signal.content.length > 50) {
        score += 0.2;
    }

    // Boost for having author info
    if (signal.author && signal.author !== 'unknown') {
        score += 0.1;
    }

    // Boost for sentiment signals
    if (signal.sentiment && Math.abs(signal.sentiment.score) > 2) {
        score += 0.1;
    }

    // Boost for buying signals
    if (signal.buyingSignals && signal.buyingSignals.confidence > 0.5) {
        score += 0.1;
    }

    return Math.min(1.0, score);
}