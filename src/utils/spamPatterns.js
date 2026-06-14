// Shared spam and intent detection patterns
// Used across Reddit, Hacker News, G2, and LinkedIn scrapers

// Strict SEO spam patterns - used for social/community sources (Reddit, LinkedIn)
// These catch SEO-optimised listicles and marketing content
export const SEO_SPAM_PATTERNS = [
    /\btop\s+\d+\b/i,           // "Top 10 alternatives"
    /\bbest\s+\d+\b/i,          // "Best 5 tools"
    /\bultimate\s+guide\b/i,    // "Ultimate guide to..."
    /\bmarket\s+share\b/i,      // Market share articles
    /\branking\b/i,             // Ranking lists
    /\blist\s+of\b/i,           // "List of alternatives"
    /\bsoftware\s+like\b/i,     // "Software like HubSpot"
    /\balternative\s+tools\b/i  // "Alternative tools to..."
];

// Lighter spam patterns for sources that are inherently structured (G2, HN)
// Only catches clear marketing/listicle content without false-positiving review content
export const SEO_SPAM_PATTERNS_LIGHT = [
    /\btop\s+\d+\b/i,
    /\bbest\s+\d+\b/i,
    /\bultimate\s+guide\b/i,
    /\bmarket\s+share\b/i
];

export const HUMAN_INTENT_PATTERNS = [
    /\blooking\s+for\b/i, /\bneed\s+(an?\s+)?alternative\b/i, /\bswitching\s+from\b/i,
    /\bmoving\s+away\b/i, /\bfed\s+up\b/i, /\btoo\s+expensive\b/i,
    /\bpricing\s+issue\b/i, /\banyone\s+using\b/i, /\brecommend\b/i,
    /\brecommendation\b/i, /\bthinking\s+(about|of)\b/i, /\breplace\b/i,
    /\bmigrate\b/i, /\bmigration\b/i, /\bwhat\s+are\s+good\b/i,
    /\bexperience\s+with\b/i, /\bworth\s+it\b/i, /\bproblem\s+with\b/i,
    /\bdissatisfied\b/i, /\bfrustrated\b/i, /\bchurn\b/i,
    /\bcancell?ing\b/i, /\bswitching\s+to\b/i, /\bwhat\s+do\s+you\s+use\b/i,
    /\bhate\b/i, /\bterrible\b/i, /\bawful\b/i, /\bdislike\b/i
];

/**
 * Check if text matches SEO spam patterns
 * @param {string} text - Text to check (should be lowercased)
 * @returns {boolean}
 */
export function isSeoSpam(text) {
    return SEO_SPAM_PATTERNS.some(r => r.test(text));
}

/**
 * Lighter spam check for G2/HN sources - avoids false positives on review/comparison content
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function isSeoSpamLight(text) {
    return SEO_SPAM_PATTERNS_LIGHT.some(r => r.test(text));
}

/**
 * Check if text contains genuine human buying intent
 * @param {string} text - Text to check (should be lowercased)
 * @returns {boolean}
 */
export function hasHumanIntent(text) {
    return HUMAN_INTENT_PATTERNS.some(r => r.test(text));
}
