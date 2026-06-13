import { describe, it, expect } from 'vitest';
import { detectPainSignals } from '../../src/classifiers/pain.js';

describe('pain classifier', () => {
    it('should detect pricing, scaling, and usability pain signals', () => {
        const text = 'This product is too expensive, very slow, and the UI is confusing.';
        const result = detectPainSignals(text);
        expect(result.hasPainSignal).toBe(true);
        expect(result.painTypes).toContain('pricing');
        expect(result.painTypes).toContain('scaling');
        expect(result.painTypes).toContain('usability');
        expect(result.severity).toBeCloseTo(0.6);
        expect(result.confidence).toBe(0.7);
    });

    it('should return no pain signals for neutral text', () => {
        const result = detectPainSignals('HubSpot works great for our team.');
        expect(result.hasPainSignal).toBe(false);
        expect(result.painTypes).toHaveLength(0);
        expect(result.severity).toBe(0);
        expect(result.confidence).toBe(0);
    });
});
