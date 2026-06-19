// Pipeline Stage 1: Multi-Source Signal Collection
// Runs all enabled scrapers in parallel with timing and error handling

import { Actor, log } from 'apify';
import { scrapeReddit } from '../scrapers/reddit.js';
import { scrapeGitHub } from '../scrapers/github.js';
import { scrapeHackerNews } from '../scrapers/hackernews.js';
import { scrapeNews } from '../scrapers/news.js';
import { scrapeG2 } from '../scrapers/g2.js';
import { scrapeLinkedIn } from '../scrapers/linkedin.js';

/**
 * Collect signals from all enabled sources in parallel.
 * 
 * @param {string[]} companies - Companies to monitor
 * @param {Object} resolvedSources - Source toggle map { reddit: bool, github: bool, ... }
 * @param {number} maxResults - Max results per company per source
 * @param {string|null} newsApiKey - Optional News API key
 * @param {Object} consecutiveFailuresParam - Consecutive failure counts per source fallback
 * @param {boolean} forceEnableAll - Override circuit breakers
 * @returns {Promise<{signals: Array, pipelineTimings: Object, consecutiveFailures: Object}>}
 */
export async function collectSignals(companies, resolvedSources, maxResults, newsApiKey = null, consecutiveFailuresParam = {}, forceEnableAll = false) {
    const pipelineTimings = {};
    const scraperTasks = [];
    
    // Load consecutiveFailures from KVS
    let store;
    let state = {};
    let consecutiveFailures = {};
    try {
        store = await Actor.openKeyValueStore('dark-funnel-monitor-state');
        state = await store.getValue('STATE') || {};
        consecutiveFailures = state.consecutiveFailures || {};
    } catch (e) {
        log.warning('Failed to load consecutive failures from KVS, using parameter', { error: e.message });
        consecutiveFailures = consecutiveFailuresParam || {};
    }

    const updatedFailures = { ...consecutiveFailures };

    // Build an array of scraper promises to run in parallel
    if (resolvedSources.reddit) {
        if (!forceEnableAll && (updatedFailures.reddit || 0) >= 3) {
            console.warn(`[CIRCUIT BREAKER] reddit disabled after 3 consecutive failures`);
            log.warning(`[CIRCUIT BREAKER] reddit disabled after 3 consecutive failures`);
        } else {
            scraperTasks.push({
                name: 'reddit',
                promise: (async () => {
                    const t0 = Date.now();
                    const signals = await scrapeReddit(companies, maxResults);
                    pipelineTimings.reddit = Date.now() - t0;
                    return signals;
                })()
            });
        }
    }

    if (resolvedSources.github) {
        if (!forceEnableAll && (updatedFailures.github || 0) >= 3) {
            console.warn(`[CIRCUIT BREAKER] github disabled after 3 consecutive failures`);
            log.warning(`[CIRCUIT BREAKER] github disabled after 3 consecutive failures`);
        } else {
            scraperTasks.push({
                name: 'github',
                promise: (async () => {
                    const t0 = Date.now();
                    const signals = await scrapeGitHub(companies, maxResults);
                    pipelineTimings.github = Date.now() - t0;
                    return signals;
                })()
            });
        }
    }

    if (resolvedSources.hackernews) {
        if (!forceEnableAll && (updatedFailures.hackernews || 0) >= 3) {
            console.warn(`[CIRCUIT BREAKER] hackernews disabled after 3 consecutive failures`);
            log.warning(`[CIRCUIT BREAKER] hackernews disabled after 3 consecutive failures`);
        } else {
            scraperTasks.push({
                name: 'hackernews',
                promise: (async () => {
                    const t0 = Date.now();
                    const signals = await scrapeHackerNews(companies, maxResults);
                    pipelineTimings.hackernews = Date.now() - t0;
                    return signals;
                })()
            });
        }
    }

    if (resolvedSources.news && newsApiKey) {
        if (!forceEnableAll && (updatedFailures.news || 0) >= 3) {
            console.warn(`[CIRCUIT BREAKER] news disabled after 3 consecutive failures`);
            log.warning(`[CIRCUIT BREAKER] news disabled after 3 consecutive failures`);
        } else {
            scraperTasks.push({
                name: 'news',
                promise: (async () => {
                    const t0 = Date.now();
                    const signals = await scrapeNews(companies, newsApiKey, maxResults);
                    pipelineTimings.news = Date.now() - t0;
                    return signals;
                })()
            });
        }
    }

    if (resolvedSources.g2) {
        if (!forceEnableAll && (updatedFailures.g2 || 0) >= 3) {
            console.warn(`[CIRCUIT BREAKER] g2 disabled after 3 consecutive failures`);
            log.warning(`[CIRCUIT BREAKER] g2 disabled after 3 consecutive failures`);
        } else {
            scraperTasks.push({
                name: 'g2',
                promise: (async () => {
                    const t0 = Date.now();
                    const signals = await scrapeG2(companies, maxResults);
                    pipelineTimings.g2 = Date.now() - t0;
                    return signals;
                })()
            });
        }
    }

    if (resolvedSources.linkedin) {
        if (!forceEnableAll && (updatedFailures.linkedin || 0) >= 3) {
            console.warn(`[CIRCUIT BREAKER] linkedin disabled after 3 consecutive failures`);
            log.warning(`[CIRCUIT BREAKER] linkedin disabled after 3 consecutive failures`);
        } else {
            scraperTasks.push({
                name: 'linkedin',
                promise: (async () => {
                    const t0 = Date.now();
                    const signals = await scrapeLinkedIn(companies, maxResults);
                    pipelineTimings.linkedin = Date.now() - t0;
                    return signals;
                })()
            });
        }
    }

    // Run all scrapers in parallel
    const results = await Promise.allSettled(scraperTasks.map(t => t.promise));
    
    const allSignals = [];
    for (let i = 0; i < results.length; i++) {
        const task = scraperTasks[i];
        const result = results[i];
        
        if (result.status === 'fulfilled') {
            allSignals.push(...result.value);
            updatedFailures[task.name] = 0;
            log.info(`${task.name}: ${result.value.length} signals collected`);
        } else {
            updatedFailures[task.name] = (updatedFailures[task.name] || 0) + 1;
            log.warning(`${task.name} scraping failed, continuing with other sources`, { error: result.reason?.message });
        }
    }

    // Persist updated failure counts back to KVS after each run
    try {
        if (!store) {
            store = await Actor.openKeyValueStore('dark-funnel-monitor-state');
        }
        state.consecutiveFailures = updatedFailures;
        await store.setValue('STATE', state);
    } catch (e) {
        log.warning('Failed to save consecutive failures to KVS', { error: e.message });
    }

    // Early Date Filter
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const cutoffIso = cutoffDate.toISOString();
    let droppedCount = 0;
    const filteredSignals = allSignals.filter(signal => {
        if (signal.dateSource === 'actual' && signal.createdAt && new Date(signal.createdAt) < new Date(cutoffIso)) {
            droppedCount++;
            return false;
        }
        if (signal.dateSource === 'inferred') {
            signal.inferredDateRisk = true;
        }
        return true;
    });
    if (droppedCount > 0) {
        log.info(`Early date filter dropped ${droppedCount} signals older than 90 days`);
    }

    // Pipeline timing summary
    if (process.env.DEBUG_MODE === 'true') {
        log.info('--- PIPELINE_TIMING_SUMMARY ---');
        let totalScrapeMs = 0;
        for (const [src, ms] of Object.entries(pipelineTimings)) {
            log.info(`  ${src}: ${ms}ms (${(ms / 1000).toFixed(1)}s)`);
            totalScrapeMs += ms;
        }
        log.info(`  TOTAL_SCRAPE_TIME: ${totalScrapeMs}ms (${(totalScrapeMs / 1000).toFixed(1)}s)`);
        if (totalScrapeMs > 0) {
            const sorted = Object.entries(pipelineTimings).sort((a, b) => b[1] - a[1]);
            log.info(`  SLOWEST_SOURCE: ${sorted[0][0]} (${sorted[0][1]}ms — ${Math.round((sorted[0][1] / totalScrapeMs) * 100)}% of total)`);
        }
        log.info('-------------------------------');
    }

    return { signals: filteredSignals, pipelineTimings, consecutiveFailures: updatedFailures };
}
