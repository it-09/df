// Pipeline Stage 1: Multi-Source Signal Collection
// Runs all enabled scrapers in parallel with timing and error handling

import { log } from 'apify';
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
 * @returns {Promise<{signals: Array, pipelineTimings: Object}>}
 */
export async function collectSignals(companies, resolvedSources, maxResults, newsApiKey = null) {
    const pipelineTimings = {};
    const scraperTasks = [];

    // Build an array of scraper promises to run in parallel
    if (resolvedSources.reddit) {
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

    if (resolvedSources.github) {
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

    if (resolvedSources.hackernews) {
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

    if (resolvedSources.news && newsApiKey) {
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

    if (resolvedSources.g2) {
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

    if (resolvedSources.linkedin) {
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

    // Run all scrapers in parallel
    const results = await Promise.allSettled(scraperTasks.map(t => t.promise));
    
    const allSignals = [];
    for (let i = 0; i < results.length; i++) {
        const task = scraperTasks[i];
        const result = results[i];
        
        if (result.status === 'fulfilled') {
            allSignals.push(...result.value);
            log.info(`${task.name}: ${result.value.length} signals collected`);
        } else {
            log.warning(`${task.name} scraping failed, continuing with other sources`, { error: result.reason?.message });
        }
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

    return { signals: allSignals, pipelineTimings };
}
