import { describe, it, expect } from 'vitest';
import { generateExplainability, generateOutreachAngle, calculateICPFit, generateCrmReady } from '../../src/classifiers/crm.js';

describe('CRM intelligence classifier', () => {
    describe('generateExplainability', () => {
        it('should map active competitor switching to precise reason', () => {
            const data = {
                switchSignals: { switchingDetected: true, switchingFrom: 'Salesforce' },
                intentScore: 80
            };
            const reasons = generateExplainability(data);
            expect(reasons).toContain('active competitor switching intent (from Salesforce)');
        });

        it('should map pricing pain to pricing reason', () => {
            const data = {
                painSignals: { hasPainSignal: true, painTypes: ['pricing'] },
                intentScore: 50
            };
            const reasons = generateExplainability(data);
            expect(reasons).toContain('pricing dissatisfaction + budget concern');
        });

        it('should return fallback if nothing else matches', () => {
            const data = {
                intentScore: 45
            };
            const reasons = generateExplainability(data);
            expect(reasons).toContain('general buying signals detected');
        });
    });

    describe('generateOutreachAngle', () => {
        it('should recommend migration support for active switching', () => {
            const data = {
                switchSignals: { switchingDetected: true }
            };
            expect(generateOutreachAngle(data)).toBe('Lead with migration support and smooth onboarding');
        });

        it('should recommend cost reduction for pricing pain', () => {
            const data = {
                painSignals: { hasPainSignal: true, painTypes: ['pricing'] }
            };
            expect(generateOutreachAngle(data)).toBe('Lead with cost reduction and ROI');
        });
    });

    describe('calculateICPFit', () => {
        it('should return HIGH for high priority, high commercial relevance, and decision maker', () => {
            const data = {
                leadPriority: 'HIGH',
                commercialRelevanceLevel: 'HIGH',
                personaSignals: { seniorityLevels: ['c-suite'] }
            };
            expect(calculateICPFit(data)).toBe('HIGH');
        });

        it('should return LOW by default', () => {
            const data = {};
            expect(calculateICPFit(data)).toBe('LOW');
        });
    });

    describe('generateCrmReady', () => {
        it('should assign correct owner and priority', () => {
            const data = {
                leadPriority: 'URGENT',
                intentScore: 90,
                whyHighIntent: 'CTO switching CRM'
            };
            const crm = generateCrmReady(data);
            expect(crm.leadReason).toBe('CTO switching CRM');
            expect(crm.recommendedOwner).toBe('Sales');
            expect(crm.followupPriority).toBe('Immediate');
            expect(crm.confidenceScore).toBe(90);
        });
    });
});
