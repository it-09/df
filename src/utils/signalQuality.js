// Signal quality helpers for determining if content is self-promotional
// vs. genuine buyer discussion.

/**
 * Determine if a signal is likely founder self-promotion rather than a buyer discussion.
 *
 * Evaluates multiple factors:
 * - Show HN tag or title prefix (founder showcasing their own project)
 * - Community engagement level (comments, points)
 * - Presence of buyer-signal language (recommendations, comparisons, switching)
 *
 * @param {Object} signal - The signal to evaluate
 * @param {Object} [signal._hit] - Raw Algolia hit (for HN-specific fields)
 * @param {number} [signal.numComments] - Number of comments
 * @param {number} [signal.points] - Points/upvotes
 * @param {string} [signal.title] - Signal title
 * @param {string} [signal.content] - Signal content
 * @param {string} [signal.source] - Signal source
 * @returns {boolean} - True if likely self-promotion, false if genuine discussion
 */
export function isLikelySelfPromotion(signal) {
    if (!signal) return false;

    // Only applies to HN sources
    if (signal.source !== 'hackernews') return false;

    const title = (signal.title || '').toLowerCase();
    const content = (signal.content || '').toLowerCase();
    const fullText = `${title} ${content}`;

    // 1. Detect Show HN — self-promotional by definition
    const isShowHN = /^show hn[:\s—–-]/i.test(signal.title || '') ||
                     (signal._hit?._tags || []).includes('show_hn');

    if (!isShowHN) return false;

    // 2. Check for founder language combined with buyer framing
    // "I built X, an alternative to Y" is self-promotion, not a buyer signal
    const hasFounderLanguage = /\b(i built|i created|i made|i launched|i developed|i am the|my project|my tool|my app|my platform|check out|try it|looking for feedback|looking for beta|would love|appreciate|we're launching|we are launching|launching|built this|built a|created a|made a|launched a|my own|our own|here's my|here is my)\b/i.test(fullText);
    const hasBuyerFraming = /\b(alternative to|alternative for|replacement for|vs\b|versus|comparison)\b/i.test(fullText);

    // Show HN with founder + buyer framing = self-promotion (founder positioning their product)
    if (hasFounderLanguage && hasBuyerFraming) return true;

    // 3. Check for buyer-signal language in the CONTENT (not title)
    // Only content-level buyer language WITHOUT founder language indicates genuine discussion
    const hasBuyerLanguageInContent = /\b(recommend|alternatives?|comparison|vs\b|versus|switching|replacing|too expensive|fed up|moving away|looking for|pricing|budget|frustrated|dissatisfied|what do you use|anyone tried|anyone using)\b/i.test(content);

    // Show HN with buyer language only in title = founder framing (still self-promotion)
    // Show HN with buyer language in content (no founder language) = genuine discussion
    if (hasBuyerLanguageInContent && !hasFounderLanguage) return false;

    // 3. Check engagement level
    // Low engagement = likely self-promotion with no community interest
    const numComments = signal.numComments || signal._hit?.num_comments || 0;
    const points = signal.points || signal._hit?.points || 0;

    const hasLowEngagement = numComments < 10 && points < 10;
    const hasHighEngagement = numComments >= 25 || points >= 50;

    if (hasLowEngagement) return true;

    // 4. High engagement with founder language but no discussion markers = still self-promotion
    // High engagement with discussion markers = genuine community conversation
    if (hasHighEngagement) {
        const hasDiscussionMarkers = /\b(comments?|replies?|discussion|questions?|answers?|debate|argue|disagree|agree|thoughts?|opinions?)\b/i.test(fullText);
        if (hasDiscussionMarkers) return false;
        // High engagement but no discussion markers — founder product launch with upvotes
        if (hasFounderLanguage) return true;
        return false;
    }

    // 5. Moderate engagement: check if content is primarily founder explaining their product
    const hasDiscussionMarkers = /\b(comments?|replies?|discussion|questions?|answers?|debate|argue|disagree|agree|thoughts?|opinions?)\b/i.test(fullText);

    if (hasFounderLanguage && !hasDiscussionMarkers) return true;

    return false;
}
