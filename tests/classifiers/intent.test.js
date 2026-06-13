import { describe, it, expect } from 'vitest';
import { detectNoise, detectBuyingSignals, detectCompetitors, predictBuyingStage } from '../../src/classifiers/intent.js';

describe('intent classifier', () => {
    describe('detectNoise', () => {
        it('should return isNoise: false for empty or regular text', () => {
            expect(detectNoise('')).toEqual({ isNoise: false, reason: null });
            expect(detectNoise('Is HubSpot pricing changing?')).toEqual({ isNoise: false, reason: null });
        });

        it('should detect hiring and announcement noise', () => {
            const result = detectNoise('We are hiring a new CEO at Vercel');
            expect(result.isNoise).toBe(true);
            expect(result.reason).toContain('Matches noise pattern');
        });
    });

    describe('detectBuyingSignals', () => {
        it('should handle empty or null text', () => {
            const result = detectBuyingSignals('');
            expect(result.hasBudgetSignal).toBe(false);
            expect(result.confidence).toBe(0);
        });

        it('should detect budget, timeline, and technical signals', () => {
            const text = 'We need a cheap alternative ASAP. Our current pipeline has API limitations.';
            const result = detectBuyingSignals(text);
            expect(result.hasBudgetSignal).toBe(true);
            expect(result.hasTimelineSignal).toBe(true);
            expect(result.hasTechnicalSignal).toBe(true);
            expect(result.hasEvaluationSignal).toBe(true);
            expect(result.confidence).toBeGreaterThan(0.5);
        });
    });

    describe('detectCompetitors', () => {
        it('should find known competitors in text', () => {
            const result = detectCompetitors('We are choosing Vercel vs Netlify', ['Netlify', 'Vercel']);
            expect(result.hasCompetitiveSignal).toBe(true);
            expect(result.competitors).toContain('Netlify');
            expect(result.competitors).toContain('Vercel');
        });
    });

    describe('predictBuyingStage', () => {
        it('should predict awareness by default', () => {
            const signals = detectBuyingSignals('Just reading about HubSpot');
            expect(predictBuyingStage(signals, {})).toBe('awareness');
        });

        it('should predict evaluation stage when evaluating alternatives', () => {
            const signals = detectBuyingSignals('HubSpot vs Salesforce alternative too expensive');
            expect(predictBuyingStage(signals, {})).toBe('evaluation');
        });

        it('should predict decision stage with timeline, budget and decision keys', () => {
            const signals = detectBuyingSignals('Our CTO approved contract purchase ASAP budget');
            expect(predictBuyingStage(signals, {})).toBe('decision');
        });
    });
});
