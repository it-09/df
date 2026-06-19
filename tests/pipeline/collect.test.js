import { describe, it, vi, expect, beforeEach, afterEach } from 'vitest';
import { collectSignals } from '../../src/pipeline/collect.js';

// Mock all scrapers
vi.mock('../../src/scrapers/reddit.js', () => ({
    scrapeReddit: vi.fn().mockResolvedValue([])
}));
vi.mock('../../src/scrapers/github.js', () => ({
    scrapeGitHub: vi.fn().mockResolvedValue([])
}));
vi.mock('../../src/scrapers/hackernews.js', () => ({
    scrapeHackerNews: vi.fn().mockResolvedValue([])
}));
vi.mock('../../src/scrapers/news.js', () => ({
    scrapeNews: vi.fn().mockResolvedValue([])
}));
vi.mock('../../src/scrapers/g2.js', () => ({
    scrapeG2: vi.fn().mockResolvedValue([])
}));
vi.mock('../../src/scrapers/linkedin.js', () => ({
    scrapeLinkedIn: vi.fn().mockResolvedValue([])
}));

vi.mock('apify', async () => {
    const getValueMock = vi.fn().mockResolvedValue({});
    const setValueMock = vi.fn().mockResolvedValue(undefined);
    const mockStoreInstance = {
        getValue: vi.fn(async (key) => getValueMock(key)),
        setValue: vi.fn(async (key, val) => setValueMock(key, val))
    };
    return {
        Actor: {
            openKeyValueStore: vi.fn().mockResolvedValue(mockStoreInstance),
            getValue: getValueMock,
            setValue: setValueMock
        },
        log: {
            info: vi.fn(),
            warning: vi.fn(),
            error: vi.fn()
        }
    };
});

describe('collectSignals date filter tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should drop signals older than 90 days with dateSource=actual', async () => {
        const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
        const mockSignals = [{
            company: 'TestCompany',
            source: 'reddit',
            title: 'Test title',
            content: 'Test content',
            createdAt: ninetyOneDaysAgo,
            dateSource: 'actual'
        }];

        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockResolvedValue(mockSignals);

        const result = await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            false
        );

        expect(result.signals.length).toBe(0);
    });

    it('should keep signals within 90 days with dateSource=actual', async () => {
        const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
        const mockSignals = [{
            company: 'TestCompany',
            source: 'reddit',
            title: 'Test title',
            content: 'Test content',
            createdAt: fortyFiveDaysAgo,
            dateSource: 'actual'
        }];

        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockResolvedValue(mockSignals);

        const result = await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            false
        );

        expect(result.signals.length).toBe(1);
        expect(result.signals[0].inferredDateRisk).toBeUndefined();
    });

    it('should pass inferred signals through regardless of age', async () => {
        const ninetyFiveDaysAgo = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
        const mockSignals = [{
            company: 'TestCompany',
            source: 'reddit',
            title: 'Test title',
            content: 'Test content',
            createdAt: ninetyFiveDaysAgo,
            dateSource: 'inferred'
        }];

        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockResolvedValue(mockSignals);

        const result = await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            false
        );

        expect(result.signals.length).toBe(1);
        expect(result.signals[0].inferredDateRisk).toBe(true);
    });

    it('should handle null createdAt gracefully', async () => {
        const mockSignals = [{
            company: 'TestCompany',
            source: 'reddit',
            title: 'Test title',
            content: 'Test content',
            createdAt: null,
            dateSource: 'actual'
        }];

        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockResolvedValue(mockSignals);

        const result = await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            false
        );

        // A null createdAt should be handled gracefully and not crash. In our logic it is kept because there is no createdAt to be < cutoff.
        expect(result.signals.length).toBe(1);
    });

    it('should log correct drop count', async () => {
        const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
        const mockSignals = [
            {
                company: 'TestCompany',
                source: 'reddit',
                title: 'Test title 1',
                content: 'Test content',
                createdAt: ninetyOneDaysAgo,
                dateSource: 'actual'
            },
            {
                company: 'TestCompany',
                source: 'reddit',
                title: 'Test title 2',
                content: 'Test content',
                createdAt: ninetyOneDaysAgo,
                dateSource: 'actual'
            }
        ];

        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockResolvedValue(mockSignals);

        const { log } = await import('apify');
        await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            false
        );

        expect(log.info).toHaveBeenCalledWith(expect.stringContaining('dropped 2 signals'));
    });
});

describe('collectSignals circuit breaker tests', () => {
    let consoleWarnSpy;

    beforeEach(() => {
        vi.clearAllMocks();
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    it('should skip scraper after 3 consecutive failures', async () => {
        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockResolvedValue([]);

        const { Actor } = await import('apify');
        Actor.getValue.mockResolvedValue({ consecutiveFailures: { reddit: 3 } });

        await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            false
        );

        expect(scrapeReddit).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[CIRCUIT BREAKER]'));
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('reddit'));
    });

    it('should still run scraper with only 2 failures', async () => {
        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockResolvedValue([]);

        const { Actor } = await import('apify');
        Actor.getValue.mockResolvedValue({ consecutiveFailures: { reddit: 2 } });

        await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            false
        );

        expect(scrapeReddit).toHaveBeenCalled();
    });

    it('should increment failure count on scraper rejection', async () => {
        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockRejectedValue(new Error('timeout'));

        const { Actor } = await import('apify');
        Actor.getValue.mockResolvedValue({ consecutiveFailures: { reddit: 1 } });

        await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            false
        );

        expect(Actor.setValue).toHaveBeenCalledWith('STATE', expect.objectContaining({
            consecutiveFailures: expect.objectContaining({ reddit: 2 })
        }));
    });

    it('should reset failure count to 0 on success', async () => {
        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockResolvedValue([]);

        const { Actor } = await import('apify');
        Actor.getValue.mockResolvedValue({ consecutiveFailures: { reddit: 2 } });

        await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            false
        );

        expect(Actor.setValue).toHaveBeenCalledWith('STATE', expect.objectContaining({
            consecutiveFailures: expect.objectContaining({ reddit: 0 })
        }));
    });

    it('should bypass circuit breaker when forceEnableAll is true', async () => {
        const { scrapeReddit } = await import('../../src/scrapers/reddit.js');
        scrapeReddit.mockResolvedValue([]);

        const { Actor } = await import('apify');
        Actor.getValue.mockResolvedValue({ consecutiveFailures: { reddit: 5 } });

        await collectSignals(
            ['TestCompany'],
            { reddit: true, github: false, hackernews: false, news: false, g2: false, linkedin: false },
            10,
            null,
            {},
            true
        );

        expect(scrapeReddit).toHaveBeenCalled();
    });
});
