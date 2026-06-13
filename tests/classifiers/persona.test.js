import { describe, it, expect } from 'vitest';
import { extractPersona, isDecisionMaker, scorePersonaInfluence } from '../../src/classifiers/persona.js';

describe('persona classifier', () => {
    it('should extract CEO, VP, and CTO persona signals', () => {
        const text = 'Our CTO is evaluating Vercel alternatives, while the VP of Engineering wants to switch.';
        const result = extractPersona(text);
        expect(result.jobTitles).toContain('CTO');
        expect(result.jobTitles).toContain('VP Engineering');
        expect(result.seniorityLevels).toContain('c-suite');
        expect(result.seniorityLevels).toContain('vp');
        expect(result.departments).toContain('engineering');
        expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should determine decision maker status correctly', () => {
        const csuitePersona = extractPersona('I am a CTO.');
        expect(isDecisionMaker(csuitePersona)).toBe(true);

        const icPersona = extractPersona('I am a software engineer.');
        expect(isDecisionMaker(icPersona)).toBe(false);
    });

    it('should score persona influence appropriately', () => {
        const csuitePersona = extractPersona('I am a CTO.');
        expect(scorePersonaInfluence(csuitePersona)).toBe(1.0);

        const icPersona = extractPersona('I am a software engineer.');
        expect(scorePersonaInfluence(icPersona)).toBe(0.2);

        expect(scorePersonaInfluence(null)).toBe(0);
    });
});
