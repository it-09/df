import { describe, it, expect } from 'vitest';
import { isG2Boilerplate } from '../../src/scrapers/g2.js';

describe('G2 boilerplate detection', () => {
    it('should reject listing page: "Explore Notion\'s top pros, cons..."', () => {
        const text = 'notion pros and cons | user likes & dislikes - g2 - explore notion\'s top pros, cons, and user-rated features...';
        expect(isG2Boilerplate(text)).toBe(true);
    });

    it('should reject listing page: "Filter 12004 reviews by..."', () => {
        const text = 'notion reviews 2026: details, pricing, & features | g2 - filter 12004 reviews by the users\' company size, role or industry...';
        expect(isG2Boilerplate(text)).toBe(true);
    });

    it('should reject listing page: "Filter 500 reviews by..."', () => {
        const text = 'hubspot crm reviews - filter 500 reviews by the users\' company size...';
        expect(isG2Boilerplate(text)).toBe(true);
    });

    it('should reject listing page: "by the users" pattern', () => {
        const text = 'salesforce reviews - rated 4.5/5 by the users\' at g2.com...';
        expect(isG2Boilerplate(text)).toBe(true);
    });

    it('should reject listing page: "Reviews | Company" pattern', () => {
        const text = 'notion reviews | g2 - read what real users say...';
        expect(isG2Boilerplate(text)).toBe(true);
    });

    it('should reject listing page: "Company Reviews 2026" pattern', () => {
        const text = 'notion reviews 2026 | details, pricing, features | g2...';
        expect(isG2Boilerplate(text)).toBe(true);
    });

    it('should reject listing page: "easily filter" pattern', () => {
        const text = 'g2 notion reviews - easily filter by category, rating, or company size...';
        expect(isG2Boilerplate(text)).toBe(true);
    });

    it('should reject listing page: "Pros and Cons ... by real" pattern', () => {
        const text = 'notion pros and cons - reviewed by real users on g2...';
        expect(isG2Boilerplate(text)).toBe(true);
    });

    it('should accept legitimate review content', () => {
        const text = 'notion is too expensive for our team. we are looking for alternatives. the pricing keeps going up and the support is terrible.';
        expect(isG2Boilerplate(text)).toBe(false);
    });

    it('should accept legitimate review: specific user complaint', () => {
        const text = 'notion review - i dislike the slow performance and constant bugs. the ui is confusing and the mobile app is buggy.';
        expect(isG2Boilerplate(text)).toBe(false);
    });

    it('should accept legitimate review: comparison content', () => {
        const text = 'notion vs coda - which is better for our team? we need good integration with slack and notion is missing that feature.';
        expect(isG2Boilerplate(text)).toBe(false);
    });

    it('should accept legitimate review: pricing complaint', () => {
        const text = 'notion pricing is too expensive for small businesses. the enterprise tier costs $15 per user per month which is overpriced.';
        expect(isG2Boilerplate(text)).toBe(false);
    });
});
