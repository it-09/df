// Negative Content Filter
// Explicitly rejects non-B2B content: marketplace listings, personal stories,
// memes, generic AI discussions, academic papers, job seekers, etc.

/**
 * Filter categories with their detection patterns.
 * Each category has a name, regex patterns, and a description.
 */
const FILTER_CATEGORIES = {
    marketplace: {
        name: 'marketplace_listing',
        patterns: [
            /\bebay\b/i,
            /\bamazon\.com\b/i,
            /\bamazon\s+listing/i,
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
            /\bbid\b.*\$\d/,
            /\$\d+.*\bbid\b/i,
            /\blisting\s+price\b/i,
            /\bproduct\s+listing\b/i,
            /\bstorefront\b/i,
            /\bshopify\.com\b/i,
            /\bwooCommerce\b/i,
        ],
    },
    personal: {
        name: 'personal_story',
        patterns: [
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
            /\bi\s+remember\b/i,
            /\bback\s+when\s+i\b/i,
        ],
    },
    meme_joke: {
        name: 'meme_or_joke',
        patterns: [
            /\blol\b/i,
            /\blmao\b/i,
            /\bomg\b/i,
            /\bhilarious\b/i,
            /\bfunny\b/i,
            /\bmeme\b/i,
            /\bshitpost\b/i,
            /\brofl\b/i,
            /\bbruh\b/i,
            /\bsmh\b/i,
            /\bfml\b/i,
            /\bjoke\b/i,
            /\bcomedy\b/i,
            /\bsatire\b/i,
            /\bparody\b/i,
            /\btonight\s+show\b/i,
            /\bstephen\s+colbert\b/i,
            /\bjimmy\s+fallon\b/i,
        ],
    },
    generic_ai: {
        name: 'generic_ai_discussion',
        patterns: [
            /\bwhat\s+is\s+ai\b/i,
            /\bfuture\s+of\s+ai\b/i,
            /\bai\s+is\s+taking\s+over\b/i,
            /\bai\s+revolution\b/i,
            /\bai\s+ethics\b/i,
            /\bai\s+safety\b/i,
            /\bai\s+research\b/i,
            /\bneural\s+network\b/i,
            /\bdeep\s+learning\b/i,
            /\bgpt-?\d/i,
            /\blarge\s+language\s+model\b/i,
            /\bllm\b/i,
            /\bchatgpt\b/i,
            /\bai\s+hallucination\b/i,
            /\bai\s+alignment\b/i,
        ],
    },
    academic: {
        name: 'academic_content',
        patterns: [
            /\bresearch\s+paper\b/i,
            /\bstudy\s+finds\b/i,
            /\bjournal\b/i,
            /\buniversity\b/i,
            /\bprofessor\b/i,
            /\bthesis\b/i,
            /\bdissertation\b/i,
            /\bpublished\s+in\b/i,
            /\barxiv\b/i,
            /\bscholar\b/i,
            /\bpeer[\s-]reviewed\b/i,
            /\bacademic\b/i,
        ],
    },
    news_buzz: {
        name: 'news_or_buzz',
        patterns: [
            /\bfunding\s+round\b/i,
            /\bseries\s+[a-f]\b/i,
            /\bipo\b/i,
            /\bacquired\s+by\b/i,
            /\bacquisition\b/i,
            /\bpress\s+release\b/i,
            /\bannounces\b/i,
            /\braises?\s+\$[\d,]+/i,
            /\bvaluation\b/i,
            /\bunicorn\b/i,
            /\bloomberg\b/i,
            /\breuters\b/i,
            /\btechcrunch\b/i,
            /\bventure\s+capital\b/i,
            /\bangel\s+investor\b/i,
        ],
    },
    job_seeker: {
        name: 'job_seeker',
        patterns: [
            /\blooking\s+for\s+a\s+job\b/i,
            /\bhiring\b.*\b(receptionist|ai|engineer|developer)\b/i,
            /\bresume\b/i,
            /\bi\s+need\s+work\b/i,
            /\bjob\s+posting\b/i,
            /\bopen\s+to\s+work\b/i,
            /\blinkedin\s+profile\b/i,
            /\bmy\s+skills\b/i,
            /\bmy\s+portfolio\b/i,
            /\bfreelance\b/i,
            /\bcontract\s+work\b/i,
        ],
    },
    non_b2b: {
        name: 'non_b2b_content',
        patterns: [
            /\bmy\s+house\b/i,
            /\bmy\s+apartment\b/i,
            /\bpersonal\s+use\b/i,
            /\bhome\s+use\b/i,
            /\bfor\s+my\s+home\b/i,
            /\bfor\s+my\s+apartment\b/i,
            /\bfor\s+my\s+condo\b/i,
            /\bfor\s+my\s+family\b/i,
            /\bfor\s+my\s+kids\b/i,
            /\bmovies?\b/i,
            /\btv\s+show\b/i,
            /\bnetflix\b/i,
            /\byoutube\s+video\b/i,
            /\btiktok\b/i,
            /\binstagram\b/i,
            /\bpodcast\s+episode\b/i,
            /\bbook\b.*\b(review|reading)\b/i,
            /\bnovel\b/i,
            /\bfiction\b/i,
            /\bgame\b.*\b(play|playing)\b/i,
        ],
    },
};

/**
 * Check if text matches negative filter patterns.
 *
 * @param {Object} signal - The signal to evaluate (needs title and content)
 * @returns {Object} { isFiltered, filterReason, filterCategory, matchedPatterns }
 */
export function filterNegatives(signal) {
    if (!signal) {
        return {
            isFiltered: false,
            filterReason: null,
            filterCategory: null,
            matchedPatterns: [],
        };
    }

    const title = (signal.title || '').toLowerCase();
    const content = (signal.content || '').toLowerCase();
    const fullText = `${title} ${content}`;

    // Check each filter category
    for (const [categoryKey, category] of Object.entries(FILTER_CATEGORIES)) {
        const matchedPatterns = [];

        for (const pattern of category.patterns) {
            if (pattern.test(fullText)) {
                matchedPatterns.push(pattern.source);
            }
        }

        // Require at least 1 match for most categories,
        // but 2+ for categories that could have false positives
        const minMatches = (categoryKey === 'generic_ai' || categoryKey === 'news_buzz') ? 2 : 1;

        if (matchedPatterns.length >= minMatches) {
            return {
                isFiltered: true,
                filterReason: `Rejected as ${category.name} (matched ${matchedPatterns.length} pattern${matchedPatterns.length > 1 ? 's' : ''})`,
                filterCategory: category.name,
                matchedPatterns,
            };
        }
    }

    return {
        isFiltered: false,
        filterReason: null,
        filterCategory: null,
        matchedPatterns: [],
    };
}
