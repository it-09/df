import { describe, it, expect } from 'vitest';
import { detectSwitchingSignals } from '../../src/classifiers/switching.js';

describe('switching classifier', () => {
    it('should detect explicit switching signals', () => {
        const text = 'We are switching from Salesforce to HubSpot.';
        const result = detectSwitchingSignals(text, ['HubSpot'], ['Salesforce']);
        expect(result.switchingDetected).toBe(true);
        expect(['HubSpot', 'Salesforce']).toContain(result.switchingFrom);
        expect(result.confidence).toBeGreaterThanOrEqual(0.4);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should return default when no switching detected', () => {
        const result = detectSwitchingSignals('Just learning about HubSpot.', ['HubSpot'], []);
        expect(result.switchingDetected).toBe(false);
        expect(result.switchingFrom).toBeNull();
    });

    // === BUG 2 FIX: Data loss complaint should NOT trigger switching ===

    it('should NOT detect switching in data loss complaint (BUG 2 fix)', () => {
        const text = 'Notion lost all my data. I had months of work and it\'s all gone. I contacted support but they took 3 days to respond and couldn\'t recover anything. I\'m so frustrated. Nothing can replace the time I spent building those pages.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(false);
        expect(result.switchingFrom).toBeNull();
    });

    it('should NOT detect switching in support frustration complaint', () => {
        const text = 'Notion support is terrible. My data got corrupted and they can\'t restore it. I\'m canceling my support ticket since it\'s useless. This is unacceptable for a paid product.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(false);
        expect(result.switchingFrom).toBeNull();
    });

    it('should NOT detect switching when "replace" is used in non-switching context', () => {
        const text = 'Notion dropped my data and nothing can replace the hours I lost. The support team said they can\'t recover it. This is a disaster.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(false);
        expect(result.switchingFrom).toBeNull();
    });

    it('should NOT detect switching when "cancel" is used for support ticket', () => {
        const text = 'Notion lost my pages. I\'m canceling my support ticket because they can\'t help me. The response time was 5 days. This is a bug that needs fixing.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(false);
        expect(result.switchingFrom).toBeNull();
    });

    it('should NOT detect switching in pure frustration (no switching language)', () => {
        const text = 'Notion is terrible. The app keeps crashing and losing my data. I\'m so frustrated with the constant bugs and glitches. The performance is awful.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(false);
        expect(result.switchingFrom).toBeNull();
    });

    it('should NOT detect switching in retrospective regret (BUG 2 - full post)', () => {
        // Real production case: user angry about data loss, says "I should have switched"
        // This is retrospective regret, NOT active switching intent
        const text = 'Two days ago I opened this page and I found all gone. Disappeared. The database with all the words was completely empty. And I couldn\'t recover anything from that page\'s version history. I\'m so angry. I can\'t accept that years of my hard work is gone. And now I\'m blaming myself, because I left it all there, online, and didn\'t switch to a better alternative like Obsidian before this happened.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(false);
        expect(result.switchingFrom).toBeNull();
    });

    // === Context-aware patterns: should detect when context is clear ===

    it('should detect switching when "replace" has tool context (no complaint)', () => {
        const text = 'We are replacing our current tool with a better platform. Notion is not meeting our needs for project management.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(true);
    });

    it('should detect switching when "cancel" has subscription context', () => {
        const text = 'I need to cancel my Notion subscription. The pricing is too expensive and we found a better alternative.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(true);
    });

    it('should detect switching when "drop" has tool context', () => {
        const text = 'We\'re dropping this tool. Notion is not working for our team and we need something with better API integration.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(true);
    });

    it('should detect switching when "leave" has platform context', () => {
        const text = 'We are leaving this platform. Notion lacks the features we need and the pricing keeps going up.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(true);
    });

    // === Existing patterns: should still work ===

    it('should detect migration intent', () => {
        const text = 'We are migrating from Notion to Coda. The migration deadline is end of Q2.';
        const result = detectSwitchingSignals(text, ['Notion'], ['Coda']);
        expect(result.switchingDetected).toBe(true);
        expect(result.switchingFrom).toBe('Notion');
    });

    it('should detect "tired of" implicit switching', () => {
        const text = 'I\'m tired of Notion\'s constant bugs. Looking for alternatives.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(true);
        expect(result.stage).toBe('considering');
    });

    it('should detect alternative-seeking', () => {
        const text = 'What are some good alternatives to Notion for project management?';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(true);
    });

    it('should detect explicit "churn" signal', () => {
        const text = 'We churned from Notion last month. The platform was too slow and buggy.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(true);
        expect(result.switchingFrom).toBe('Notion');
        expect(result.stage).toBe('decided');
    });

    it('should detect "ditch" signal', () => {
        const text = 'Time to ditch Notion. The performance issues are unacceptable.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(true);
        expect(result.stage).toBe('decided');
    });

    it('should detect "exit" signal', () => {
        const text = 'We\'re exiting our Notion contract. The tool doesn\'t meet our compliance needs.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(true);
        expect(result.switchingFrom).toBe('Notion');
    });

    // === Regression: "switch-off" (radio technology) should NOT trigger switching ===

    it('should NOT detect switching for "switch-off" (radio/tech context)', () => {
        const text = 'Long Wave radio era set to end with switch-off. I am mostly pushing back on the notion that digital means all or nothing audio.';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(false);
    });

    it('should NOT detect switching for "switch off" (toggling context)', () => {
        const text = 'How to switch off notifications in Notion settings';
        const result = detectSwitchingSignals(text, ['Notion'], []);
        expect(result.switchingDetected).toBe(false);
    });
});
