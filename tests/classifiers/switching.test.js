import { describe, it, expect } from 'vitest';
import { detectSwitchingSignals } from '../../src/classifiers/switching.js';

describe('switching classifier', () => {
    it('should detect switching signals', () => {
        const text = 'We are switching from Salesforce to HubSpot.';
        const result = detectSwitchingSignals(text, ['HubSpot'], ['Salesforce']);
        expect(result.switchingDetected).toBe(true);
        expect(result.switchingFrom).toBe('HubSpot'); // matches based on simple presence in the list
        expect(result.confidence).toBe(0.6);
    });

    it('should return default when no switching detected', () => {
        const result = detectSwitchingSignals('Just learning about HubSpot.', ['HubSpot'], []);
        expect(result.switchingDetected).toBe(false);
        expect(result.switchingFrom).toBeNull();
    });
});
