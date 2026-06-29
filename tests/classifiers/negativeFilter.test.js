import { describe, it, expect } from 'vitest';
import { filterNegatives } from '../../src/classifiers/negativeFilter.js';

describe('negativeFilter', () => {
    describe('filterNegatives', () => {
        it('should return not filtered for null signal', () => {
            const result = filterNegatives(null);
            expect(result.isFiltered).toBe(false);
        });

        it('should reject eBay listings', () => {
            const signal = {
                title: 'AI Receptionist Device - eBay',
                content: 'Buy this AI receptionist device for your office. Free shipping available.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('marketplace_listing');
        });

        it('should reject Amazon listings', () => {
            const signal = {
                title: 'AI Receptionist on Amazon',
                content: 'Check out this product on Amazon.com. Add to cart for $99.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('marketplace_listing');
        });

        it('should reject Etsy listings', () => {
            const signal = {
                title: 'Handmade AI Receptionist Sign - Etsy',
                content: 'Custom AI receptionist desk sign for your office.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('marketplace_listing');
        });

        it('should reject personal stories', () => {
            const signal = {
                title: 'My experience as a receptionist',
                content: 'I worked as a receptionist for 10 years and here is what I learned about the job.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('personal_story');
        });

        it('should reject meme/joke content', () => {
            const signal = {
                title: 'AI receptionist taking over the world lol',
                content: 'This is hilarious, imagine an AI receptionist answering calls and roasting people lmao',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('meme_or_joke');
        });

        it('should reject generic AI discussions', () => {
            const signal = {
                title: 'What is AI and how does it work?',
                content: 'Let me explain the future of AI and neural networks. ChatGPT and LLMs are changing everything.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('generic_ai_discussion');
        });

        it('should reject academic content', () => {
            const signal = {
                title: 'Research paper on AI receptionist adoption',
                content: 'This university study published in a journal examines the thesis that AI receptionists will replace human workers.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('academic_content');
        });

        it('should reject news/buzz content', () => {
            const signal = {
                title: 'AI Receptionist startup raises $50M Series A',
                content: 'The unicorn startup announced a funding round with valuation of $500M. Bloomberg reports the acquisition.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('news_or_buzz');
        });

        it('should reject job seeker posts', () => {
            const signal = {
                title: 'AI receptionist developer looking for work',
                content: 'I am a software engineer looking for a job. Here is my resume and portfolio.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('job_seeker');
        });

        it('should reject non-B2B content', () => {
            const signal = {
                title: 'AI receptionist for my apartment',
                content: 'I want an AI receptionist for my home. Personal use only, for my family.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(true);
            expect(result.filterCategory).toBe('non_b2b_content');
        });

        it('should NOT reject genuine B2B buying signal', () => {
            const signal = {
                title: 'Looking for AI receptionist solution for our dental practice',
                content: 'We are evaluating AI receptionist options for our 5-location dental practice. Currently using a human receptionist but need to scale. Looking at alternatives and comparing pricing.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(false);
        });

        it('should NOT reject content about switching vendors', () => {
            const signal = {
                title: 'Frustrated with our current phone answering service',
                content: 'Our current virtual receptionist is terrible. We are switching from Smith AI to a better alternative. Need something with better integration.',
            };
            const result = filterNegatives(signal);
            expect(result.isFiltered).toBe(false);
        });

        it('should require 2+ matches for generic_ai category', () => {
            // Single generic AI mention should not be rejected
            const signal = {
                title: 'AI receptionist solution needed',
                content: 'We need an AI receptionist for our office. The ChatGPT technology seems promising for this use case.',
            };
            const result = filterNegatives(signal);
            // Should NOT be rejected because only one generic AI indicator (ChatGPT)
            expect(result.isFiltered).toBe(false);
        });
    });
});
