// Topic Relevance Scorer
// Determines if a signal is actually about the searched topic,
// not just a passing mention or unrelated content.

import { MIN_TOPIC_RELEVANCE_SCORE } from '../constants.js';
import { matchesCompany } from '../utils/normalizer.js';

/**
 * Check if a signal is relevant to the searched topic.
 * Uses the dynamic topic profile to score relevance.
 *
 * @param {Object} signal - The signal to evaluate
 * @param {Object} topicProfile - The topic profile from buildTopicProfile()
 * @returns {Object} { isTopicRelevant, topicScore, matchedTerms, rejectionReason }
 */
export function checkTopicRelevance(signal, topicProfile) {
    if (!signal || !topicProfile) {
        return {
            isTopicRelevant: false,
            topicScore: 0,
            matchedTerms: [],
            rejectionReason: 'Missing signal or topic profile',
        };
    }

    const title = (signal.title || '').toLowerCase();
    const content = (signal.content || '').toLowerCase();
    const fullText = `${title} ${content}`;
    const originalTitle = signal.title || '';
    const originalContent = signal.content || '';

    const matchedTerms = [];
    let score = 0;

    // 1. Check primary keywords (highest weight)
    for (const term of topicProfile.primary) {
        const inTitle = matchesCompany(title, term, originalTitle);
        const inContent = matchesCompany(content, term, originalContent);

        if (inTitle && inContent) {
            matchedTerms.push(term);
            score += 0.4; // Strong match: in both title and content
        } else if (inTitle) {
            matchedTerms.push(term);
            score += 0.35; // Title match is strong
        } else if (inContent) {
            matchedTerms.push(term);
            score += 0.25; // Content match is moderate
        }
    }

    // 2. Check related keywords (moderate weight)
    for (const term of topicProfile.related) {
        if (matchesCompany(fullText, term, `${originalTitle} ${originalContent}`)) {
            matchedTerms.push(term);
            score += 0.15;
        }
    }

    // 3. Bonus for multiple primary keyword matches
    const primaryMatches = matchedTerms.filter(t => topicProfile.primary.includes(t));
    if (primaryMatches.length >= 2) {
        score += 0.1; // Bonus for multi-term match
    }

    // 4. Check if title contains the query (strong signal)
    if (matchesCompany(title, topicProfile.originalQuery, originalTitle)) {
        score += 0.15;
    }

    // 5. Penalty for very short content (likely a passing mention)
    if (content.length < 50) {
        score *= 0.5;
    }

    // 6. Normalize score to 0-1 range
    const normalizedScore = Math.min(1.0, score);

    // 7. Determine relevance
    const isTopicRelevant = normalizedScore >= MIN_TOPIC_RELEVANCE_SCORE;

    let rejectionReason = null;
    if (!isTopicRelevant) {
        if (matchedTerms.length === 0) {
            rejectionReason = `No topic keywords matched for "${topicProfile.originalQuery}"`;
        } else {
            rejectionReason = `Topic relevance score ${normalizedScore.toFixed(2)} below threshold ${MIN_TOPIC_RELEVANCE_SCORE} (matched: ${matchedTerms.join(', ')})`;
        }
    }

    return {
        isTopicRelevant,
        topicScore: normalizedScore,
        matchedTerms: [...new Set(matchedTerms)],
        rejectionReason,
    };
}
