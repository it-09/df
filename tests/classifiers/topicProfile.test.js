import { describe, it, expect } from 'vitest';
import { buildTopicProfile } from '../../src/classifiers/topicProfile.js';

describe('topicProfile', () => {
    describe('buildTopicProfile', () => {
        it('should return empty profile for empty input', () => {
            const profile = buildTopicProfile('');
            expect(profile.primary).toEqual([]);
            expect(profile.related).toEqual([]);
            expect(profile.commercial).toEqual([]);
            expect(profile.negative).toEqual([]);
        });

        it('should return empty profile for null input', () => {
            const profile = buildTopicProfile(null);
            expect(profile.primary).toEqual([]);
        });

        it('should build profile for "AI receptionist"', () => {
            const profile = buildTopicProfile('AI receptionist');
            expect(profile.primary).toContain('ai receptionist');
            expect(profile.primary).toContain('ai');
            expect(profile.primary).toContain('receptionist');
            expect(profile.related.length).toBeGreaterThan(0);
            expect(profile.commercial.length).toBeGreaterThan(0);
            expect(profile.negative.length).toBeGreaterThan(0);
            expect(profile.originalQuery).toBe('AI receptionist');
        });

        it('should build profile for "CRM"', () => {
            const profile = buildTopicProfile('CRM');
            expect(profile.primary).toContain('crm');
            expect(profile.related).toContain('customer relationship management');
            expect(profile.commercial).toContain('pricing');
            expect(profile.commercial).toContain('alternative');
        });

        it('should build profile for "customer support automation"', () => {
            const profile = buildTopicProfile('customer support automation');
            expect(profile.primary).toContain('customer support automation');
            expect(profile.primary).toContain('customer');
            expect(profile.primary).toContain('support');
            expect(profile.primary).toContain('automation');
            expect(profile.related.length).toBeGreaterThan(0);
        });

        it('should include commercial modifiers', () => {
            const profile = buildTopicProfile('AI receptionist');
            expect(profile.commercial).toContain('pricing');
            expect(profile.commercial).toContain('alternative');
            expect(profile.commercial).toContain('vs');
            expect(profile.commercial).toContain('looking for');
            expect(profile.commercial).toContain('frustrated');
            expect(profile.commercial).toContain('evaluating');
        });

        it('should include negative terms', () => {
            const profile = buildTopicProfile('AI receptionist');
            expect(profile.negative).toContain('ebay');
            expect(profile.negative).toContain('amazon');
            expect(profile.negative).toContain('etsy');
            expect(profile.negative).toContain('lol');
            expect(profile.negative).toContain('meme');
        });

        it('should expand compound terms for any topic', () => {
            const profile = buildTopicProfile('ATS');
            expect(profile.related).toContain('ats software');
            expect(profile.related).toContain('ats tool');
            expect(profile.related).toContain('ats platform');
            expect(profile.related).toContain('best ats');
        });

        it('should handle multi-word queries', () => {
            const profile = buildTopicProfile('virtual receptionist software');
            expect(profile.primary).toContain('virtual receptionist software');
            expect(profile.primary).toContain('virtual');
            expect(profile.primary).toContain('receptionist');
            expect(profile.primary).toContain('software');
        });

        it('should deduplicate primary keywords', () => {
            const profile = buildTopicProfile('AI AI receptionist');
            const aiCount = profile.primary.filter(kw => kw === 'ai').length;
            expect(aiCount).toBe(1);
        });

        it('should set originalQuery to the input', () => {
            const profile = buildTopicProfile('sales engagement platform');
            expect(profile.originalQuery).toBe('sales engagement platform');
        });
    });
});
