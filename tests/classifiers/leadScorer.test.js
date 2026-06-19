import { describe, it, expect } from 'vitest';
import { calculateIntentScore } from '../../src/classifiers/leadScorer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('calculateIntentScore recency decay tests', () => {
    it('should return multiplier ~1.0 for signal created today', () => {
        const mockSignals = {};
        const { recencyMultiplier } = calculateIntentScore(mockSignals, 'reddit', '', 0, false, 0);
        expect(recencyMultiplier).toBeGreaterThanOrEqual(0.97);
        expect(recencyMultiplier).toBeLessThanOrEqual(1.0);
    });

    it('should return multiplier ~0.40 for 30-day-old signal', () => {
        const mockSignals = {};
        const { recencyMultiplier } = calculateIntentScore(mockSignals, 'reddit', '', 30, false, 0);
        expect(recencyMultiplier).toBeGreaterThanOrEqual(0.37);
        expect(recencyMultiplier).toBeLessThanOrEqual(0.43);
    });

    it('should return multiplier ~0.07 for 90-day-old signal', () => {
        const mockSignals = {};
        const { recencyMultiplier } = calculateIntentScore(mockSignals, 'reddit', '', 90, false, 0);
        expect(recencyMultiplier).toBeGreaterThanOrEqual(0.05);
        expect(recencyMultiplier).toBeLessThanOrEqual(0.09);
    });

    it('should NOT apply flat +10 or -15 adjustments anywhere', () => {
        const outputPath = path.resolve(__dirname, '../../src/pipeline/output.js');
        const outputCode = fs.readFileSync(outputPath, 'utf8');
        expect(outputCode).not.toContain('intentScore + 10');
        expect(outputCode).not.toContain('intentScore - 15');
        expect(outputCode).not.toContain('intentScore +10');
        expect(outputCode).not.toContain('intentScore -15');
    });
});
