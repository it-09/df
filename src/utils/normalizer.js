// Data normalization utilities
import crypto from 'crypto';

/**
 * Common English words that are also company names.
 * When these appear as lowercase in text, they're likely the common word,
 * not the company. Require capitalized form for a match.
 */
const AMBIGUOUS_COMPANY_WORDS = new Set([
    'notion', // "notion" (idea) vs "Notion" (app)
    'stripe', // "stripe" (pattern) vs "Stripe" (payments)
    'docker', // "docker" (container ship) vs "Docker" (containers)
    'asana', // "asana" (yoga pose) vs "Asana" (PM tool)
    'zendesk', // less ambiguous but keep for safety
    'freshdesk', // less ambiguous but keep for safety
    'monday', // "monday" (day) vs "Monday.com"
    'clickup', // less ambiguous
    'intercom', // less ambiguous
    'airtable', // less ambiguous
    'github', // less ambiguous
    'gitlab', // less ambiguous
]);

/**
 * Check if text contains the company name as a whole word (not substring).
 * Uses lookaround assertions for word boundaries — works with alphabetic
 * company names and handles edge cases better than \b (e.g., names with periods).
 * For ambiguous names (e.g., "notion"), requires capitalized form in original text.
 * @param {string} text - Text to search (lowercased)
 * @param {string} companyName - Company name to find (lowercased)
 * @param {string} [originalText] - Original un-lowercased text (for capitalization check)
 * @returns {boolean}
 */
export function matchesCompany(text, companyName, originalText) {
    if (!text || !companyName) return false;
    const escaped = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![a-zA-Z])${escaped}(?![a-zA-Z])`, 'i');

    // For ambiguous words that are also common English words,
    // require the capitalized form in original text (if available)
    if (AMBIGUOUS_COMPANY_WORDS.has(companyName.toLowerCase()) && originalText) {
        const capitalized = companyName.charAt(0).toUpperCase() + companyName.slice(1).toLowerCase();
        const capitalizedPattern = new RegExp(`(?<![a-zA-Z])${capitalized}(?![a-zA-Z])`);
        return capitalizedPattern.test(originalText);
    }

    return pattern.test(text);
}

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

    // Word-boundary match (prevents "stripes" matching "Stripe")
    for (const company of companies) {
        const companyLower = company.toLowerCase();
        if (matchesCompany(mentionLower, companyLower, mention) || matchesCompany(companyLower, mentionLower, company)) {
            return company;
        }
    }

    // Simple Levenshtein distance for typos - only if both are at least 6 chars
    for (const company of companies) {
        const companyLower = company.toLowerCase();
        if (mentionLower.length >= 6 && companyLower.length >= 6) {
            const distance = levenshteinDistance(mentionLower, companyLower);
            const maxLength = Math.max(mentionLower.length, companyLower.length);
            const similarity = 1 - (distance / maxLength);

            if (similarity > 0.8) {
                return company;
            }
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
 * Generate a collision-resistant hash for deduplication
 * @param {string} text - Text to hash
 * @returns {string} - SHA-256 hash string
 */
export function simpleHash(text) {
    if (!text) return '';
    return crypto.createHash('sha256').update(text).digest('hex');
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

/**
 * Extract and parse a date prefix from search engine snippets.
 * Supports relative times (e.g., '3 days ago') and absolute date formats.
 * 
 * @param {string} snippet - The search result snippet
 * @returns {string|null} - ISO string or null
 */
export function parseSnippetDate(snippet) {
    if (!snippet) return null;

    const text = snippet.toLowerCase().trim();

    // 1. Relative times
    const relativeHourMatch = text.match(/\b(\d+)\s+hour(s)?\s+ago\b/i);
    if (relativeHourMatch) {
        const hours = parseInt(relativeHourMatch[1], 10);
        const date = new Date();
        date.setHours(date.getHours() - hours);
        return date.toISOString();
    }

    const relativeDayMatch = text.match(/\b(\d+)\s+day(s)?\s+ago\b/i);
    if (relativeDayMatch) {
        const days = parseInt(relativeDayMatch[1], 10);
        const date = new Date();
        date.setDate(date.getDate() - days);
        return date.toISOString();
    }

    const relativeWeekMatch = text.match(/\b(\d+)\s+week(s)?\s+ago\b/i);
    if (relativeWeekMatch) {
        const weeks = parseInt(relativeWeekMatch[1], 10);
        const date = new Date();
        date.setDate(date.getDate() - (weeks * 7));
        return date.toISOString();
    }

    const relativeMonthMatch = text.match(/\b(\d+)\s+month(s)?\s+ago\b/i);
    if (relativeMonthMatch) {
        const months = parseInt(relativeMonthMatch[1], 10);
        const date = new Date();
        date.setMonth(date.getMonth() - months);
        return date.toISOString();
    }

    const relativeYearMatch = text.match(/\b(\d+)\s+year(s)?\s+ago\b/i);
    if (relativeYearMatch) {
        const years = parseInt(relativeYearMatch[1], 10);
        const date = new Date();
        date.setFullYear(date.getFullYear() - years);
        return date.toISOString();
    }

    // 2. Absolute dates
    const monthsMap = {
        jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
        may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
        oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
    };

    // Format: Month Day, Year (e.g. May 15, 2024 or May 15 2024 or Jan. 12, 2026)
    const monthDayYearMatch = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+(\d{1,2}),?\s+(\d{4})\b/i);
    if (monthDayYearMatch) {
        const monthName = monthDayYearMatch[1].toLowerCase();
        const day = parseInt(monthDayYearMatch[2], 10);
        const year = parseInt(monthDayYearMatch[3], 10);
        const month = monthsMap[monthName];
        if (month !== undefined) {
            const date = new Date(Date.UTC(year, month, day));
            return date.toISOString();
        }
    }

    // Format: Day Month Year (e.g. 15 May 2024 or 15 Jan 2026)
    const dayMonthYearMatch = text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+(\d{4})\b/i);
    if (dayMonthYearMatch) {
        const day = parseInt(dayMonthYearMatch[1], 10);
        const monthName = dayMonthYearMatch[2].toLowerCase();
        const year = parseInt(dayMonthYearMatch[3], 10);
        const month = monthsMap[monthName];
        if (month !== undefined) {
            const date = new Date(Date.UTC(year, month, day));
            return date.toISOString();
        }
    }

    // Format: ISO Date (YYYY-MM-DD)
    const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoMatch) {
        const year = parseInt(isoMatch[1], 10);
        const month = parseInt(isoMatch[2], 10) - 1;
        const day = parseInt(isoMatch[3], 10);
        const date = new Date(Date.UTC(year, month, day));
        return date.toISOString();
    }

    // Format: Month Year (e.g. Dec 2025 or May 2024)
    const monthYearMatch = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+(\d{4})\b/i);
    if (monthYearMatch) {
        const monthName = monthYearMatch[1].toLowerCase();
        const year = parseInt(monthYearMatch[2], 10);
        const month = monthsMap[monthName];
        if (month !== undefined) {
            const date = new Date(Date.UTC(year, month, 1));
            return date.toISOString();
        }
    }

    return null;
}

/**
 * Estimate the creation date of a Reddit post based on its base36 ID.
 * 
 * @param {string} url - Reddit post URL
 * @returns {string|null} - ISO string or null
 */
export function estimateRedditPostDate(url) {
    if (!url) return null;
    const match = url.match(/\/comments\/([a-z0-9]+)/i);
    if (!match) return null;
    
    const id36 = match[1];
    const val = parseInt(id36, 36);
    if (isNaN(val)) return null;

    const points = [
        [1227664364, 1607672280], // kax3vw -> Dec 11, 2020
        [2293640465, 1679363550], // 11xkob5 -> Mar 21, 2023
        [2840873381, 1708891500]  // 1azdrxh -> Feb 25, 2024
    ];

    let timestamp;
    if (val <= points[0][0]) {
        const [x1, y1] = points[0];
        const [x2, y2] = points[1];
        const slope = (y2 - y1) / (x2 - x1);
        timestamp = y1 + slope * (val - x1);
    } else if (val >= points[points.length - 1][0]) {
        const [x1, y1] = points[points.length - 2];
        const [x2, y2] = points[points.length - 1];
        const slope = (y2 - y1) / (x2 - x1);
        timestamp = y2 + slope * (val - x2);
    } else {
        for (let i = 0; i < points.length - 1; i++) {
            const [x1, y1] = points[i];
            const [x2, y2] = points[i + 1];
            if (val >= x1 && val <= x2) {
                const slope = (y2 - y1) / (x2 - x1);
                timestamp = y1 + slope * (val - x1);
                break;
            }
        }
    }

    if (!timestamp) return null;
    
    // Ensure estimated date is not in the future or pre-2010
    const minTimestamp = 1262304000; // Jan 1, 2010
    const maxTimestamp = Date.now() / 1000;
    timestamp = Math.max(minTimestamp, Math.min(maxTimestamp, timestamp));

    return new Date(timestamp * 1000).toISOString();
}

/**
 * Extract timestamp from a LinkedIn activity ID (Snowflake format).
 * 
 * @param {string} url - LinkedIn post URL
 * @returns {string|null} - ISO string or null
 */
export function estimateLinkedInPostDate(url) {
    if (!url) return null;
    const match = url.match(/(?:activity|update)(?:-|_|:)(\d+)/i);
    if (!match) return null;

    try {
        const idStr = match[1];
        const idBin = BigInt(idStr).toString(2);
        // Snowflake ID: first 41 bits represent timestamp in milliseconds
        const first41Bits = idBin.slice(0, -22); // remove last 22 bits
        const timestampMs = parseInt(first41Bits, 2);

        if (isNaN(timestampMs) || timestampMs <= 0) return null;

        const minMs = 1262304000000; // Jan 1, 2010
        const maxMs = Date.now();
        const finalMs = Math.max(minMs, Math.min(maxMs, timestampMs));

        return new Date(finalMs).toISOString();
    } catch (err) {
        return null;
    }
}

/**
 * Estimate G2 review date based on sequential review ID.
 * 
 * @param {string} url - G2 review URL
 * @returns {string|null} - ISO string or null
 */
export function estimateG2ReviewDate(url) {
    if (!url) return null;
    const match = url.match(/review-(\d+)/i) || url.match(/\/reviews\/(\d+)/i);
    if (!match) return null;

    const val = parseInt(match[1], 10);
    if (isNaN(val)) return null;

    const points = [
        [1500000, 1514764800], // Jan 1, 2018
        [4300000, 1609459200], // Jan 1, 2021
        [8200000, 1704067200], // Jan 1, 2024
        [10500000, 1780272000] // June 1, 2026
    ];

    let timestamp;
    if (val <= points[0][0]) {
        const [x1, y1] = points[0];
        const [x2, y2] = points[1];
        const slope = (y2 - y1) / (x2 - x1);
        timestamp = y1 + slope * (val - x1);
    } else if (val >= points[points.length - 1][0]) {
        const [x1, y1] = points[points.length - 2];
        const [x2, y2] = points[points.length - 1];
        const slope = (y2 - y1) / (x2 - x1);
        timestamp = y2 + slope * (val - x2);
    } else {
        for (let i = 0; i < points.length - 1; i++) {
            const [x1, y1] = points[i];
            const [x2, y2] = points[i + 1];
            if (val >= x1 && val <= x2) {
                const slope = (y2 - y1) / (x2 - x1);
                timestamp = y1 + slope * (val - x1);
                break;
            }
        }
    }

    if (!timestamp) return null;

    const minTimestamp = 1262304000; // Jan 1, 2010
    const maxTimestamp = Date.now() / 1000;
    timestamp = Math.max(minTimestamp, Math.min(maxTimestamp, timestamp));

    return new Date(timestamp * 1000).toISOString();
}

/**
 * Unified date resolver that parses snippets or estimates dates based on ID.
 * 
 * @param {string} snippet - Search snippet text
 * @param {string} url - Post URL
 * @param {string} source - Source channel ('reddit', 'linkedin', 'g2')
 * @returns {{createdAt: string, dateSource: string}}
 */
export function parseOrEstimatePostDate(snippet, url, source) {
    // 1. Try to parse from snippet first
    const snippetDate = parseSnippetDate(snippet);
    if (snippetDate) {
        return { createdAt: snippetDate, dateSource: 'actual' };
    }

    // 2. Try URL ID estimations
    if (source === 'reddit') {
        const est = estimateRedditPostDate(url);
        if (est) return { createdAt: est, dateSource: 'actual' };
    }
    if (source === 'linkedin') {
        const est = estimateLinkedInPostDate(url);
        if (est) return { createdAt: est, dateSource: 'actual' };
    }
    if (source === 'g2') {
        const est = estimateG2ReviewDate(url);
        if (est) return { createdAt: est, dateSource: 'actual' };
    }

    // 3. Fallback to today
    return { createdAt: new Date().toISOString(), dateSource: 'inferred' };
}