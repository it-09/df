import { describe, it, expect } from 'vitest';
import { checkTopicRelevance } from '../../src/classifiers/topicRelevance.js';
import { buildTopicProfile } from '../../src/classifiers/topicProfile.js';

describe('topicRelevance', () => {
    describe('checkTopicRelevance', () => {
        const aiReceptionistProfile = buildTopicProfile('AI receptionist');

        it('should reject null signal', () => {
            const result = checkTopicRelevance(null, aiReceptionistProfile);
            expect(result.isTopicRelevant).toBe(false);
        });

        it('should reject null topic profile', () => {
            const result = checkTopicRelevance({ title: 'test', content: 'test' }, null);
            expect(result.isTopicRelevant).toBe(false);
        });

        it('should accept relevant post about AI receptionist evaluation', () => {
            const signal = {
                title: 'Looking for an AI receptionist for our dental practice',
                content: 'We are evaluating AI receptionist solutions for our 5-location dental practice. Need something that handles appointment scheduling and patient inquiries.',
            };
            const result = checkTopicRelevance(signal, aiReceptionistProfile);
            expect(result.isTopicRelevant).toBe(true);
            expect(result.topicScore).toBeGreaterThan(0.4);
            expect(result.matchedTerms.length).toBeGreaterThan(0);
        });

        it('should accept post with AI receptionist in title', () => {
            const signal = {
                title: 'Best AI receptionist software for small business',
                content: 'I am looking for recommendations on what people are using for phone answering automation.',
            };
            const result = checkTopicRelevance(signal, aiReceptionistProfile);
            expect(result.isTopicRelevant).toBe(true);
        });

        it('should accept post with virtual receptionist (related term)', () => {
            const signal = {
                title: 'Need a virtual receptionist solution',
                content: 'Our front desk automation needs are growing. We need a virtual receptionist that can handle call answering and appointment scheduling.',
            };
            const result = checkTopicRelevance(signal, aiReceptionistProfile);
            expect(result.isTopicRelevant).toBe(true);
        });

        it('should reject post about unrelated topic', () => {
            const signal = {
                title: 'Best project management software for remote teams',
                content: 'We are looking for a kanban board tool for our engineering team. Need something with good integration with GitHub.',
            };
            const result = checkTopicRelevance(signal, aiReceptionistProfile);
            expect(result.isTopicRelevant).toBe(false);
        });

        it('should give low score for very short content with minimal keyword match', () => {
            const signal = {
                title: 'AI',
                content: 'Cool.',
            };
            const result = checkTopicRelevance(signal, aiReceptionistProfile);
            // With soft signal approach, short content still gets a low score but is not hard-rejected
            expect(result.topicScore).toBeLessThan(0.4);
        });

        it('should give higher score for title + content match', () => {
            const signalBoth = {
                title: 'AI receptionist pricing comparison',
                content: 'Looking at AI receptionist pricing across different vendors.',
            };
            const signalContentOnly = {
                title: 'Phone answering solution needed',
                content: 'We need an AI receptionist for our office.',
            };
            const resultBoth = checkTopicRelevance(signalBoth, aiReceptionistProfile);
            const resultContentOnly = checkTopicRelevance(signalContentOnly, aiReceptionistProfile);
            expect(resultBoth.topicScore).toBeGreaterThan(resultContentOnly.topicScore);
        });

        it('should include matched terms in result', () => {
            const signal = {
                title: 'AI receptionist vs virtual receptionist comparison',
                content: 'Comparing AI receptionist and virtual receptionist solutions for our clinic.',
            };
            const result = checkTopicRelevance(signal, aiReceptionistProfile);
            expect(result.matchedTerms.length).toBeGreaterThan(0);
            expect(result.matchedTerms).toContain('ai receptionist');
        });

        it('should provide rejection reason when not relevant', () => {
            const signal = {
                title: 'Best restaurants in downtown',
                content: 'Looking for a good place to eat dinner tonight.',
            };
            const result = checkTopicRelevance(signal, aiReceptionistProfile);
            expect(result.isTopicRelevant).toBe(false);
            expect(result.rejectionReason).toBeTruthy();
            expect(result.rejectionReason).toContain('No topic keywords matched');
        });
    });
});
