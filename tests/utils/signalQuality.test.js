import { describe, it, expect } from 'vitest';
import { isLikelySelfPromotion } from '../../src/utils/signalQuality.js';

describe('isLikelySelfPromotion', () => {
    it('should return false for non-HN sources', () => {
        const signal = {
            source: 'reddit',
            title: 'Show HN: My cool tool',
            content: 'I built this',
        };
        expect(isLikelySelfPromotion(signal)).toBe(false);
    });

    it('should return false for non-Show HN posts', () => {
        const signal = {
            source: 'hackernews',
            title: 'Accepted and ghosted: interviewing at Stripe',
            content: 'Discussion about hiring',
        };
        expect(isLikelySelfPromotion(signal)).toBe(false);
    });

    it('should return true for Show HN with low engagement and no buyer language', () => {
        const signal = {
            source: 'hackernews',
            title: 'Show HN: My cool tool',
            content: 'I built this tool for developers',
            numComments: 3,
            points: 5,
        };
        expect(isLikelySelfPromotion(signal)).toBe(true);
    });

    it('should return false for Show HN with buyer language', () => {
        const signal = {
            source: 'hackernews',
            title: 'Show HN: My cool tool',
            content: 'Looking for alternatives to Stripe, this is too expensive',
            numComments: 3,
            points: 5,
        };
        expect(isLikelySelfPromotion(signal)).toBe(false);
    });

    it('should return true for Show HN with founder language and high engagement but no discussion', () => {
        const signal = {
            source: 'hackernews',
            title: 'Show HN: My cool tool',
            content: 'I built this tool for developers',
            numComments: 25,
            points: 50,
        };
        // High engagement but founder language + no discussion = still self-promotion
        expect(isLikelySelfPromotion(signal)).toBe(true);
    });

    it('should return false for Show HN with high engagement AND discussion markers', () => {
        const signal = {
            source: 'hackernews',
            title: 'Show HN: My cool tool',
            content: 'I built this tool. What do you think? Any questions?',
            numComments: 25,
            points: 50,
        };
        // High engagement + discussion markers = genuine community conversation
        expect(isLikelySelfPromotion(signal)).toBe(false);
    });

    it('should return true for Show HN with founder language and no discussion markers', () => {
        const signal = {
            source: 'hackernews',
            title: 'Show HN: My cool tool',
            content: 'I built this tool, check it out, would love feedback',
            numComments: 15,
            points: 20,
        };
        expect(isLikelySelfPromotion(signal)).toBe(true);
    });

    it('should return false for Show HN with founder language AND discussion markers', () => {
        const signal = {
            source: 'hackernews',
            title: 'Show HN: My cool tool',
            content: 'I built this tool, check it out. What do you think? Any questions?',
            numComments: 15,
            points: 20,
        };
        expect(isLikelySelfPromotion(signal)).toBe(false);
    });

    it('should handle null signal', () => {
        expect(isLikelySelfPromotion(null)).toBe(false);
    });

    it('should detect Show HN from _tags array', () => {
        const signal = {
            source: 'hackernews',
            title: 'My cool tool',
            content: 'I built this',
            _hit: { _tags: ['story', 'show_hn'] },
            numComments: 3,
            points: 5,
        };
        expect(isLikelySelfPromotion(signal)).toBe(true);
    });

    it('should return true for Show HN with "Built this" + "alternative to"', () => {
        const signal = {
            source: 'hackernews',
            title: 'Show HN: Notion-to-site – sync any Notion database to local Markdown',
            content: 'Built this while syncing my own blog from Notion. Good alternative to paid options like Super.so.',
            numComments: 5,
            points: 8,
        };
        expect(isLikelySelfPromotion(signal)).toBe(true);
    });

    it('should return true for Show HN with "launching" + "alternative to"', () => {
        const signal = {
            source: 'hackernews',
            title: 'Show HN: OpenKnowledge – open source AI-first alternative to Notion',
            content: "We're launching a markdown editor with Claude integration.",
            numComments: 3,
            points: 5,
        };
        expect(isLikelySelfPromotion(signal)).toBe(true);
    });
});
