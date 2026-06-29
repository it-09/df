import { describe, it, vi, expect, beforeEach, afterEach } from 'vitest';
import { outputResults } from '../../src/pipeline/output.js';

// Mock Actor.setValue, Actor.pushData, and Actor.charge from 'apify'
vi.mock('apify', async () => ({
    Actor: {
        getValue: vi.fn(),
        setValue: vi.fn(),
        charge: vi.fn().mockResolvedValue(undefined),
        pushData: vi.fn().mockResolvedValue(undefined)
    },
    log: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    }
}));

describe('outputResults webhook tests', () => {
    let mockFetch;
    let originalActorRunId;

    beforeEach(() => {
        // Reset all mocks
        vi.clearAllMocks();

        // Mock fetch
        mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK'
        });
        vi.stubGlobal('fetch', mockFetch);

        // Save original APIFY_ACTOR_RUN_ID
        originalActorRunId = process.env.APIFY_ACTOR_RUN_ID;
    });

    afterEach(() => {
        // Restore original APIFY_ACTOR_RUN_ID
        process.env.APIFY_ACTOR_RUN_ID = originalActorRunId;

        // Remove stubbed global
        vi.unstubAllGlobals();
    });

    it('should POST signals in batches when webhookUrl is provided', async () => {
        const mockSignals = [];
        for (let i = 0; i < 30; i++) {
            mockSignals.push({
                company: 'TestCompany',
                source: 'reddit',
                title: `Test title ${i}`,
                content: 'Test content',
                createdAt: new Date().toISOString(),
                dateSource: 'actual',
                leadPriority: 'HIGH',
                intentScore: 80,
                signalQuality: 'HIGH',
                url: `https://example.com/reddit/${i}`
            });
        }

        await outputResults({
            enrichedSignals: mockSignals,
            webhookUrl: 'https://example.com/webhook',
            webhookBatchSize: 25,
            monitoringMode: 'off',
            competitorWatch: [],
            previousStats: {},
            seenHashes: {},
            companyProfiles: {},
            validCompanies: ['TestCompany'],
            token: 'test',
            datasetId: 'test',
            consecutiveFailures: {}
        });

        expect(mockFetch).toHaveBeenCalledTimes(2);

        // Check first call
        const firstCall = mockFetch.mock.calls[0];
        expect(firstCall[0]).toBe('https://example.com/webhook');
        expect(firstCall[1].method).toBe('POST');
        expect(firstCall[1].headers['Content-Type']).toBe('application/json');
        const firstBody = JSON.parse(firstCall[1].body);
        expect(firstBody.event).toBe('high_intent_signal');
        expect(firstBody.signals.length).toBe(25);
        expect(firstBody.timestamp).toBeDefined();

        // Check second call
        const secondCall = mockFetch.mock.calls[1];
        const secondBody = JSON.parse(secondCall[1].body);
        expect(secondBody.signals.length).toBe(5);
    });

    it('should not call fetch when webhookUrl is not provided', async () => {
        const mockSignals = [{
            company: 'TestCompany',
            source: 'reddit',
            title: 'Test title',
            content: 'Test content',
            createdAt: new Date().toISOString(),
            dateSource: 'actual',
            leadPriority: 'HIGH',
            intentScore: 80,
            signalQuality: 'HIGH',
            url: 'https://example.com/reddit/1'
        }];

        await outputResults({
            enrichedSignals: mockSignals,
            webhookUrl: null,
            monitoringMode: 'off',
            competitorWatch: [],
            previousStats: {},
            seenHashes: {},
            companyProfiles: {},
            validCompanies: ['TestCompany'],
            token: 'test',
            datasetId: 'test',
            consecutiveFailures: {}
        });

        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not throw when webhook POST fails', async () => {
        const mockSignals = [{
            company: 'TestCompany',
            source: 'reddit',
            title: 'Test title',
            content: 'Test content',
            createdAt: new Date().toISOString(),
            dateSource: 'actual',
            leadPriority: 'HIGH',
            intentScore: 80,
            signalQuality: 'HIGH',
            url: 'https://example.com/reddit/1'
        }];

        mockFetch.mockRejectedValue(new Error('Connection refused'));

        await expect(outputResults({
            enrichedSignals: mockSignals,
            webhookUrl: 'https://example.com/webhook',
            monitoringMode: 'off',
            competitorWatch: [],
            previousStats: {},
            seenHashes: {},
            companyProfiles: {},
            validCompanies: ['TestCompany'],
            token: 'test',
            datasetId: 'test',
            consecutiveFailures: {}
        })).resolves.not.toThrow();
    });

    it('should include actorRunId in webhook payload', async () => {
        process.env.APIFY_ACTOR_RUN_ID = 'test-run-123';

        const mockSignals = [{
            company: 'TestCompany',
            source: 'reddit',
            title: 'Test title',
            content: 'Test content',
            createdAt: new Date().toISOString(),
            dateSource: 'actual',
            leadPriority: 'HIGH',
            intentScore: 80,
            signalQuality: 'HIGH',
            url: 'https://example.com/reddit/1'
        }];

        await outputResults({
            enrichedSignals: mockSignals,
            webhookUrl: 'https://example.com/webhook',
            monitoringMode: 'off',
            competitorWatch: [],
            previousStats: {},
            seenHashes: {},
            companyProfiles: {},
            validCompanies: ['TestCompany'],
            token: 'test',
            datasetId: 'test',
            consecutiveFailures: {}
        });

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.actorRunId).toBe('test-run-123');
    });
});
