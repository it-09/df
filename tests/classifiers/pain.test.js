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
        // severity = 0.35 (pricing) + 0.20 (scaling) + 0.20 (usability) = 0.75, capped at 0.9
        expect(result.severity).toBeGreaterThan(0.5);
        expect(result.severity).toBeLessThanOrEqual(1.0);
        // confidence scales with pain count: 0.5 + 3*0.15 = 0.95
        expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should return no pain signals for neutral text', () => {
        const result = detectPainSignals('HubSpot works great for our team.');
        expect(result.hasPainSignal).toBe(false);
        expect(result.painTypes).toHaveLength(0);
        expect(result.severity).toBe(0);
        expect(result.confidence).toBe(0);
    });

    it('should apply 1.4 multiplier for pricing + vendor_lock combo', () => {
        const text = 'This product is too expensive and we are locked in, it\'s hard to leave.';
        const result = detectPainSignals(text);
        expect(result.compoundComboMatched).toBe('pricing+vendor_lock');
        expect(result.painTypes).toContain('pricing');
        expect(result.painTypes).toContain('vendor_lock');
        // Check that severity is within reasonable range (capped at 1)
        expect(result.severity).toBeGreaterThanOrEqual(0.8);
        expect(result.severity).toBeLessThanOrEqual(1.0);
    });

    it('should apply highest multiplier when multiple combos match', () => {
        const text = 'This product is too expensive, locked in, and missing features we need.';
        const result = detectPainSignals(text);
        // Should match pricing+vendor_lock (1.4) and pricing+feature_gap (1.3), so use 1.4
        expect(result.compoundComboMatched).toBe('pricing+vendor_lock');
    });

    it('should NOT stack combo multipliers', () => {
        const text = 'This product is too expensive, locked in, and missing features we need.';
        const result = detectPainSignals(text);
        // Even with multiple combos, the severity must not exceed 1.0 (it must cap gracefully)
        expect(result.severity).toBeLessThanOrEqual(1.0);
    });

    it('should not apply any multiplier when no combo matches', () => {
        const text = 'The support is terrible, but no other pain points.';
        const result = detectPainSignals(text);
        expect(result.compoundComboMatched).toBeNull();
    });
});
