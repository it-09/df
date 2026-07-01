import { describe, it, expect } from 'vitest';
import { matchesCompany, fuzzyMatchCompany, cleanText, simpleHash, deduplicateSignals, calculateConfidence, parseSnippetDate, estimateRedditPostDate, estimateLinkedInPostDate, estimateG2ReviewDate, parseOrEstimatePostDate } from '../../src/utils/normalizer.js';

describe('normalizer utility', () => {
    describe('matchesCompany', () => {
        it('should match exact company name as whole word', () => {
            expect(matchesCompany('we use Stripe for payments', 'Stripe')).toBe(true);
        });

        it('should NOT match substring (stripes ≠ Stripe)', () => {
            expect(matchesCompany('CSS stripes pattern', 'Stripe')).toBe(false);
        });

        it('should NOT match partial word (systemd ≠ Freshdesk)', () => {
            expect(matchesCompany('systemd replacement', 'Freshdesk')).toBe(false);
        });

        it('should match company at start of text', () => {
            expect(matchesCompany('Notion is great', 'Notion')).toBe(true);
        });

        it('should match company at end of text', () => {
            expect(matchesCompany('I love HubSpot', 'HubSpot')).toBe(true);
        });

        it('should match company surrounded by spaces', () => {
            expect(matchesCompany('use Salesforce daily', 'Salesforce')).toBe(true);
        });

        it('should match company after punctuation', () => {
            expect(matchesCompany('tried,Stripe,worked', 'Stripe')).toBe(true);
        });

        it('should handle company names with special chars', () => {
            expect(matchesCompany('using C++ for project', 'C++')).toBe(true);
        });

        it('should return false for empty text', () => {
            expect(matchesCompany('', 'Stripe')).toBe(false);
        });

        it('should return false for empty company name', () => {
            expect(matchesCompany('some text', '')).toBe(false);
        });

        it('should require capitalization for ambiguous words like "notion" when originalText provided', () => {
            // Without originalText — falls through to normal matching
            expect(matchesCompany('pushing back on the notion that digital means all', 'notion')).toBe(true);
            // With originalText and lowercase "notion" — should NOT match
            expect(matchesCompany('pushing back on the notion that digital means all', 'notion', 'pushing back on the notion that digital means all')).toBe(false);
            // With originalText and capitalized "Notion" — should match
            expect(matchesCompany('pushing back on the Notion that digital means all', 'notion', 'pushing back on the Notion that digital means all')).toBe(true);
        });

        it('should require capitalization for "stripe" when originalText provided', () => {
            // Without originalText — falls through to normal matching
            expect(matchesCompany('the cat has a stripe', 'stripe')).toBe(true);
            // With originalText and lowercase "stripe" — should NOT match
            expect(matchesCompany('the cat has a stripe', 'stripe', 'the cat has a stripe')).toBe(false);
            // With originalText and capitalized "Stripe" — should match
            expect(matchesCompany('the cat has a Stripe', 'stripe', 'the cat has a Stripe')).toBe(true);
        });

        it('should NOT require capitalization for non-ambiguous companies', () => {
            // HubSpot is not ambiguous — lowercase should match
            expect(matchesCompany('we use hubspot daily', 'hubspot')).toBe(true);
        });
    });

    describe('fuzzyMatchCompany', () => {
        it('should perform exact match', () => {
            expect(fuzzyMatchCompany('hubspot', ['HubSpot', 'Salesforce'])).toBe('HubSpot');
        });

        it('should perform partial match', () => {
            expect(fuzzyMatchCompany('HubSpot Inc.', ['HubSpot', 'Salesforce'])).toBe('HubSpot');
        });

        it('should perform Levenshtein match with typo tolerance', () => {
            expect(fuzzyMatchCompany('hubspit', ['HubSpot', 'Salesforce'])).toBe('HubSpot');
        });

        it('should return null if no match', () => {
            expect(fuzzyMatchCompany('Vercel', ['HubSpot', 'Salesforce'])).toBeNull();
        });

        it('should NOT fuzzy match "Sage" vs "Page" (both <6 chars)', () => {
            expect(fuzzyMatchCompany('Sage', ['Page', 'HubSpot'])).toBeNull();
        });

        it('should fuzzy match "HubSpot" vs "HubSpots" (both >=6 chars)', () => {
            expect(fuzzyMatchCompany('HubSpots', ['HubSpot', 'Salesforce'])).toBe('HubSpot');
        });
    });

    describe('cleanText', () => {
        it('should normalize spaces, tabs, and newlines', () => {
            const text = '  hello \t\n world  ';
            expect(cleanText(text)).toBe('hello world');
        });

        it('should strip non-ASCII characters', () => {
            const text = 'hello € world';
            expect(cleanText(text)).toBe('hello  world'); // € is non-ASCII and gets stripped, leaving double spaces which collapse to single space or just stripped
        });
    });

    describe('simpleHash', () => {
        it('should generate SHA-256 hex hash', () => {
            const hash1 = simpleHash('test text');
            const hash2 = simpleHash('test text');
            expect(hash1).toBe(hash2);
            expect(hash1).toHaveLength(64);
        });
    });

    describe('deduplicateSignals', () => {
        it('should remove duplicate signals', () => {
            const signals = [
                { title: 'Dup Post', content: 'Same content here' },
                { title: 'Dup Post', content: 'Same content here' },
                { title: 'Unique Post', content: 'Different content' }
            ];
            const deduped = deduplicateSignals(signals);
            expect(deduped).toHaveLength(2);
            expect(deduped[0].title).toBe('Dup Post');
            expect(deduped[1].title).toBe('Unique Post');
        });
    });

    describe('calculateConfidence', () => {
        it('should calculate confidence based on signal fields', () => {
            const signal = {
                title: 'Post Title',
                content: 'This is a long content to boost the score above 50 characters.',
                author: 'John Doe',
                sentiment: { score: 3 },
                buyingSignals: { confidence: 0.8 }
            };
            expect(calculateConfidence(signal)).toBeCloseTo(1.0);
        });
    });

    describe('parseSnippetDate', () => {
        it('should return null for empty or dateless snippet', () => {
            expect(parseSnippetDate('')).toBeNull();
            expect(parseSnippetDate('HubSpot announced alternatives today.')).toBeNull();
        });

        it('should parse relative days', () => {
            const dateStr = parseSnippetDate('3 days ago ... HubSpot is expensive');
            expect(dateStr).not.toBeNull();
            const date = new Date(dateStr);
            const diffDays = Math.round((new Date() - date) / (1000 * 60 * 60 * 24));
            expect(diffDays).toBe(3);
        });

        it('should parse Month Day, Year format', () => {
            const dateStr = parseSnippetDate('May 15, 2024 ... HubSpot vs Vercel');
            expect(dateStr).not.toBeNull();
            expect(dateStr.startsWith('2024-05-15')).toBe(true);
        });

        it('should parse Day Month Year format', () => {
            const dateStr = parseSnippetDate('15 May 2024 ... HubSpot vs Vercel');
            expect(dateStr).not.toBeNull();
            expect(dateStr.startsWith('2024-05-15')).toBe(true);
        });

        it('should parse ISO Date format', () => {
            const dateStr = parseSnippetDate('2024-05-15 ... HubSpot vs Vercel');
            expect(dateStr).not.toBeNull();
            expect(dateStr.startsWith('2024-05-15')).toBe(true);
        });

        it('should parse Month Year format', () => {
            const dateStr = parseSnippetDate('May 2024 ... HubSpot vs Vercel');
            expect(dateStr).not.toBeNull();
            expect(dateStr.startsWith('2024-05-01')).toBe(true);
        });
    });

    describe('estimateRedditPostDate', () => {
        it('should estimate date correctly for known base36 IDs', () => {
            const dateStr = estimateRedditPostDate('https://reddit.com/r/CRM/comments/1azdrxh/hubspot_alternatives/');
            expect(dateStr).not.toBeNull();
            // Should estimate close to Feb 25, 2024
            expect(dateStr.startsWith('2024-02-25')).toBe(true);
        });
    });

    describe('estimateLinkedInPostDate', () => {
        it('should parse snowflake timestamp from activity ID', () => {
            const dateStr = estimateLinkedInPostDate('https://linkedin.com/posts/activity-7138259296076619777');
            expect(dateStr).not.toBeNull();
            // Should resolve to Dec 6, 2023
            expect(dateStr.startsWith('2023-12-06')).toBe(true);
        });
    });

    describe('estimateG2ReviewDate', () => {
        it('should estimate date correctly for review ID', () => {
            const dateStr = estimateG2ReviewDate('https://www.g2.com/products/hubspot/reviews/hubspot-review-8200000');
            expect(dateStr).not.toBeNull();
            // Should resolve to Jan 1, 2024
            expect(dateStr.startsWith('2024-01-01')).toBe(true);
        });
    });

    describe('parseOrEstimatePostDate', () => {
        it('should prioritize snippet dates over URL estimations', () => {
            const res = parseOrEstimatePostDate('May 15, 2024 ... HubSpot alternatives', 'https://reddit.com/comments/1azdrxh', 'reddit');
            expect(res.createdAt.startsWith('2024-05-15')).toBe(true);
            expect(res.dateSource).toBe('actual');
        });

        it('should fall back to estimation if snippet lacks a date', () => {
            const res = parseOrEstimatePostDate('HubSpot alternatives discussed', 'https://reddit.com/comments/1azdrxh', 'reddit');
            expect(res.createdAt.startsWith('2024-02-25')).toBe(true);
            expect(res.dateSource).toBe('actual');
        });
    });
});
