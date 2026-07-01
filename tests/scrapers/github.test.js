import { describe, it, expect } from 'vitest';

describe('GitHub scraper noise patterns', () => {
    const rejectIfContains = [
        "rebranding", "epic:", "rename:", "schema migration", "ci/cd",
        "internal tooling", "deployment rollout", "api rate limit",
        "bug report", "stack trace", "error:", "exception:",
        "fix:", "feat:", "chore:", "refactor:", "test:", "docs:",
        "pull request", "merge", "pr #", "release notes",
        "npm install", "pip install", "yarn add", "pnpm add",
        "sdk", "wrapper", "binding", "connector", "plugin",
        "oauth", "auth token", "api key", "webhook", "endpoint",
        "not implemented", "undefined method", "typeerror",
        "mcp server", "model context protocol",
        "changelog", "breaking change", "deprecat",
        "unit test", "integration test", "ci pipeline",
        "dockerfile", "kubernetes", "helm chart",
        "implement", "add support for", "feature request",
        "weekly discovery", "new tools found", "awesome list",
        "curated list", "tools found", "roundup"
    ];

    const mustContainOneOf = [
        "alternative to", "switching from", "replacing", "moving away",
        "too expensive", "competitor", " vs ", "versus", "pricing",
        "recommendation", "comparison", "considering switching",
        "better than", "canceling", "cancelling", "frustrated with",
        "dissatisfied", "wish it had", "looking for alternative"
    ];

    function shouldReject(text) {
        const lowerText = text.toLowerCase();
        const hasTechnicalNoise = rejectIfContains.some(phrase => lowerText.includes(phrase));
        const hasCommercialIntent = mustContainOneOf.some(phrase => lowerText.includes(phrase));
        return hasTechnicalNoise || !hasCommercialIntent;
    }

    it('should reject "Weekly Discovery: 50 new tools found"', () => {
        expect(shouldReject('Weekly Discovery: 50 new tools found (2026-06-29)')).toBe(true);
    });

    it('should reject "Awesome list of CRM tools"', () => {
        expect(shouldReject('Awesome list of CRM tools for startups')).toBe(true);
    });

    it('should reject "Curated list of alternatives"', () => {
        expect(shouldReject('Curated list of alternatives to HubSpot')).toBe(true);
    });

    it('should reject "Roundup of best tools"', () => {
        expect(shouldReject('Roundup of best tools for project management')).toBe(true);
    });

    it('should reject "Tools found this week"', () => {
        expect(shouldReject('Tools found this week: 10 new discoveries')).toBe(true);
    });

    it('should NOT reject genuine buyer signal', () => {
        expect(shouldReject('Looking for alternative to HubSpot, too expensive')).toBe(false);
    });

    it('should NOT reject switching discussion', () => {
        expect(shouldReject('Switching from Salesforce to a competitor')).toBe(false);
    });

    it('should reject content without commercial intent', () => {
        expect(shouldReject('Just merged a PR for the API connector')).toBe(true);
    });
});
