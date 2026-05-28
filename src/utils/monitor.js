// Recurring Monitoring & Delta Tracking
// Handles state persistence across runs to prevent duplicate leads

import { Actor, log } from 'apify';
import crypto from 'crypto';

const STATE_STORE_NAME = 'dark-funnel-monitor-state';
const MAX_HASHES = 10000;

/**
 * Generate a unique hash for a signal to track deduplication across runs
 * @param {Object} signal - Raw or enriched signal
 * @returns {string} - MD5 hash
 */
export function generateSignalHash(signal) {
    const text = `${signal.company || ''}-${signal.source || ''}-${signal.author || ''}-${signal.title || ''}-${(signal.content || '').substring(0, 100)}`;
    return crypto.createHash('md5').update(text).digest('hex');
}

/**
 * Load the previous state from the Named Key-Value Store
 * @returns {Promise<Object>} - { seenHashes: Set, previousStats: Object }
 */
export async function loadMonitorState() {
    try {
        const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
        const state = await store.getValue('STATE') || { seenHashes: [], previousStats: {} };
        
        return {
            seenHashes: new Set(state.seenHashes || []),
            previousStats: state.previousStats || {}
        };
    } catch (err) {
        log.warning('Failed to load monitor state, starting fresh.', { error: err.message });
        return { seenHashes: new Set(), previousStats: {} };
    }
}

/**
 * Save the current state to the Named Key-Value Store
 * @param {Set} seenHashes - Set of all seen hashes
 * @param {Object} currentStats - Aggregated company stats from this run
 */
export async function saveMonitorState(seenHashes, currentStats) {
    try {
        // Keep only the most recent N hashes to prevent memory bloat
        const hashesArray = Array.from(seenHashes);
        const trimmedHashes = hashesArray.slice(-MAX_HASHES);
        
        const state = {
            lastRun: new Date().toISOString(),
            seenHashes: trimmedHashes,
            previousStats: currentStats
        };
        
        const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
        await store.setValue('STATE', state);
        log.info('Monitor state saved successfully.');
    } catch (err) {
        log.error('Failed to save monitor state.', { error: err.message });
    }
}

/**
 * Compare current aggregated stats against previous stats for watched competitors
 * @param {Array} aggregated - Current run company stats
 * @param {Object} previousStats - Previous run company stats
 * @param {Array} competitorWatch - List of competitors to track
 * @returns {Object} - Competitor risk map
 */
export function calculateCompetitorRisk(aggregated, previousStats, competitorWatch) {
    const riskMap = {};
    if (!competitorWatch || competitorWatch.length === 0) return riskMap;

    for (const comp of competitorWatch) {
        const current = aggregated.find(c => c.company.toLowerCase() === comp.toLowerCase());
        const previous = previousStats[comp];

        if (current && previous) {
            // Calculate pain type counts from arrays
            const currPainTypes = current.painTypes || [];
            const prevPainTypes = previous.painTypes || [];
            
            const currPricing = currPainTypes.filter(p => p === 'pricing').length;
            const prevPricing = prevPainTypes.filter(p => p === 'pricing').length;
            
            // Calculate switching intent counts
            const currSwitch = current.switchingSignals || 0;
            const prevSwitch = previous.switchingSignals || 0;

            const calcGrowth = (c, p) => {
                if (p === 0 && c > 0) return '+100% (New)';
                if (p === 0 && c === 0) return '0%';
                const growth = Math.round(((c - p) / p) * 100);
                return growth > 0 ? `+${growth}%` : `${growth}%`;
            };

            riskMap[comp] = {
                pricingComplaints: calcGrowth(currPricing, prevPricing),
                switchingSignals: calcGrowth(currSwitch, prevSwitch),
                riskLevel: (currSwitch > prevSwitch || currPricing > prevPricing) ? 'HIGH' : 'STABLE'
            };
        }
    }

    return riskMap;
}
