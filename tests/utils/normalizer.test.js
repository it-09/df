import { describe, it, expect } from 'vitest';
import { fuzzyMatchCompany, cleanText, simpleHash, deduplicateSignals, calculateConfidence } from '../../src/utils/normalizer.js';

describe('normalizer utility', () => {
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
});
