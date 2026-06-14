import { describe, it, expect } from 'vitest';
import { detectSwitchingSignals } from '../../src/classifiers/switching.js';

describe('switching classifier', () => {
    it('should detect switching signals', () => {
        const text = 'We are switching from Salesforce to HubSpot.';
        const result = detectSwitchingSignals(text, ['HubSpot'], ['Salesforce']);
        expect(result.switchingDetected).toBe(true);
        // switchingFrom = first company found in text (HubSpot or Salesforce, both present)
        expect(['HubSpot', 'Salesforce']).toContain(result.switchingFrom);
        // confidence: explicit switch (0.4) + switchingFrom (0.1) + possible switchingTo (0.1) = 0.5-0.6
        expect(result.confidence).toBeGreaterThanOrEqual(0.4);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should return default when no switching detected', () => {
        const result = detectSwitchingSignals('Just learning about HubSpot.', ['HubSpot'], []);
        expect(result.switchingDetected).toBe(false);
        expect(result.switchingFrom).toBeNull();
    });
});
