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

// Marketplace and product listing patterns
export const MARKETPLACE_PATTERNS = [
    /\bebay\b/i,
    /\bamazon\.com\b/i,
    /\betsy\b/i,
    /\bcraigslist\b/i,
    /\bfacebook\s*marketplace\b/i,
    /\bmercari\b/i,
    /\bposhmark\b/i,
    /\bofferup\b/i,
    /\bletgo\b/i,
    /\bdepop\b/i,
    /\bbuy\s+now\b/i,
    /\bfree\s+shipping\b/i,
    /\badd\s+to\s+cart\b/i,
    /\bcheck\s+out\s+my\b/i,
    /\bselling\s+my\b/i,
    /\bfor\s+sale\b/i,
    /\bauction\b/i,
    /\bproduct\s+listing\b/i,
    /\bstorefront\b/i,
];

// Personal story patterns (non-B2B)
export const PERSONAL_STORY_PATTERNS = [
    /\bi\s+worked\s+as\s+a\b/i,
    /\bmy\s+experience\s+as\b/i,
    /\bi\s+got\s+fired\b/i,
    /\bmy\s+career\s+as\b/i,
    /\bi\s+was\s+a\s+receptionist\b/i,
    /\bwhen\s+i\s+was\s+a\b/i,
    /\bmy\s+job\s+as\b/i,
    /\bi\s+quit\s+my\s+job\b/i,
    /\bmy\s+boss\b/i,
    /\bmy\s+coworker\b/i,
    /\bpersonal\s+story\b/i,
    /\bmy\s+life\b/i,
];

// Generic AI discussion patterns (no buying intent)
export const GENERIC_AI_PATTERNS = [
    /\bwhat\s+is\s+ai\b/i,
    /\bfuture\s+of\s+ai\b/i,
    /\bai\s+is\s+taking\s+over\b/i,
    /\bai\s+revolution\b/i,
    /\bai\s+ethics\b/i,
    /\bai\s+safety\b/i,
    /\bai\s+research\b/i,
    /\bneural\s+network\b/i,
    /\bdeep\s+learning\b/i,
    /\bllm\b/i,
    /\bchatgpt\b/i,
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

/**
 * Check if text matches marketplace/product listing patterns
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function isMarketplaceListing(text) {
    return MARKETPLACE_PATTERNS.some(r => r.test(text));
}

/**
 * Check if text is a personal story (non-B2B)
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function isPersonalStory(text) {
    return PERSONAL_STORY_PATTERNS.some(r => r.test(text));
}

/**
 * Check if text is a generic AI discussion without buying intent
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function isGenericAIDiscussion(text) {
    return GENERIC_AI_PATTERNS.some(r => r.test(text));
}
