import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeReddit } from '../../src/scrapers/reddit.js';
import { Actor } from 'apify';

// Mock the apify Actor
vi.mock('apify', () => {
    return {
        Actor: {
            call: vi.fn(),
            apifyClient: {
                dataset: vi.fn()
            }
        },
        log: {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn()
        }
    };
});

describe('Reddit Scraper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.DEBUG_MODE = 'false';
    });

    it('should map Actor output correctly and filter spam', async () => {
        // Mock Actor.call to return a dummy run
        Actor.call.mockResolvedValue({ defaultDatasetId: 'test-dataset' });
        
        // Mock dataset items
        Actor.apifyClient.dataset.mockReturnValue({
            listItems: vi.fn().mockResolvedValue({
                items: [
                    {
                        "title": "Looking for alternatives to HubSpot",
                        "text": "We are fed up with HubSpot pricing and need a switch. Any recommendations?",
                        "url": "https://www.reddit.com/r/SaaS/comments/test/",
                        "author": "TestUser",
                        "subreddit": "SaaS",
                        "created_utc_iso": "2026-06-18T14:35:16Z",
                        "scraped_at_iso": "2026-06-19T06:24:20Z"
                    },
                    {
                        "title": "Hilarious meme about HubSpot",
                        "text": "This is a joke post, it should be filtered out.",
                        "url": "https://www.reddit.com/r/memes/comments/joke/",
                        "author": "MemeGuy",
                        "subreddit": "memes",
                        "created_utc_iso": "2026-06-18T12:00:00Z",
                        "scraped_at_iso": "2026-06-19T06:24:20Z"
                    }
                ]
            })
        });

        const results = await scrapeReddit(['HubSpot']);
        
        // Should only return the non-spam post
        expect(results.length).toBe(1);
        
        const signal = results[0];
        expect(signal.company).toBe('HubSpot');
        expect(signal.source).toBe('reddit');
        expect(signal.title).toBe("Looking for alternatives to HubSpot");
        expect(signal.content).toBe("We are fed up with HubSpot pricing and need a switch. Any recommendations?");
        expect(signal.url).toBe("https://www.reddit.com/r/SaaS/comments/test/");
        expect(signal.author).toBe("TestUser");
        expect(signal.subreddit).toBe("r/SaaS");
        expect(signal.createdAt).toBe("2026-06-18T14:35:16Z");
        expect(signal.scrapedAt).toBe("2026-06-19T06:24:20Z");
        
        // Ensure Actor.call was called with correct parameters
        expect(Actor.call).toHaveBeenCalledWith('spry_wholemeal/reddit-scraper', {
            mode: 'search',
            searchTargets: [{ query: 'HubSpot', maxResults: 30 }],
            timeframe: 'month'
        });
    });
});
