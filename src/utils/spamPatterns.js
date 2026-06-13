// Shared spam and intent detection patterns
// Used across Reddit, Hacker News, G2, and LinkedIn scrapers

export const SEO_SPAM_PATTERNS = [
    /\btop\s+\d+\b/i, /\bbest\s+.*alternative/i, /\b2025\b/i, /\b2026\b/i,
    /\bguide\b/i, /\breview\b/i, /\bcomparison\b/i, /\bcompetitors?\b/i,
    /\bvs\b/i, /\bversus\b/i, /\bmarket\s+share\b/i, /\branking\b/i,
    /\blist\s+of\b/i, /\bsoftware\s+like\b/i, /\balternative\s+tools\b/i
];

export const HUMAN_INTENT_PATTERNS = [
    /\blooking\s+for\b/i, /\bneed\s+alternative\b/i, /\bswitching\s+from\b/i,
    /\bmoving\s+away\b/i, /\bfed\s+up\b/i, /\btoo\s+expensive\b/i,
    /\bpricing\s+issue\b/i, /\banyone\s+using\b/i, /\brecommend\b/i,
    /\brecommendation\b/i, /\bthinking\s+about\b/i, /\breplace\b/i,
    /\bmigrate\b/i, /\bmigration\b/i, /\bwhat\s+are\s+good\b/i,
    /\bexperience\s+with\b/i, /\bworth\s+it\b/i, /\bproblem\s+with\b/i,
    /\bdissatisfied\b/i, /\bfrustrated\b/i, /\bchurn\b/i
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
 * Check if text contains genuine human buying intent
 * @param {string} text - Text to check (should be lowercased)
 * @returns {boolean}
 */
export function hasHumanIntent(text) {
    return HUMAN_INTENT_PATTERNS.some(r => r.test(text));
}
