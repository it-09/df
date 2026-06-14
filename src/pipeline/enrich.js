// Pipeline Stage 4: Enrichment, ICP matching, and Source Balancing
import { log } from 'apify';
import { generateOutreachAngle, calculateICPFit, generateCrmReady } from '../classifiers/crm.js';
import { generateSignalHash } from '../utils/monitor.js';

/**
 * Enrich qualified signals with company profiles, CRM formats, ICP fits, and apply Source Balancing.
 * 
 * @param {Array} enrichedSignals - Signals from qualify stage
 * @param {Object} companyProfiles - Company profiles cache
 * @param {Set} seenHashes - Set of previously seen signal hashes
 * @param {string} monitoringMode - 'off' | 'delta' | etc
 * @param {string[]} validCompanies - Target companies
 * @returns {Array} - Enriched and balanced signals
 */
export function enrichSignals(enrichedSignals, companyProfiles, seenHashes, monitoringMode, validCompanies) {
    // 1. Finalize each signal with CRM attributes, outreach, and ICP fit
    for (const signal of enrichedSignals) {
        const crmData = {
            intentScore: signal.intentScore, 
            leadPriority: signal.leadPriority, 
            commercialRelevanceLevel: signal.commercialRelevanceLevel, 
            switchSignals: signal.switchSignals, 
            painSignals: signal.painSignals, 
            personaSignals: signal.personaSignals, 
            buyingStage: signal.buyingStage, 
            buyingSignals: signal.buyingSignals, 
            competitorSignals: signal.competitorSignals
        };

        signal.recommendedOutreachAngle = generateOutreachAngle(crmData);
        signal.estimatedICPFit = calculateICPFit(crmData);
        signal.companyEnrichment = companyProfiles[signal.company] || {};
        signal.crmReady = generateCrmReady({ ...crmData, whyHighIntent: signal.whyHighIntent });

        const signalHash = generateSignalHash(signal);
        signal.isNew = !seenHashes.has(signalHash);
        if (monitoringMode !== 'off') {
            seenHashes.add(signalHash);
        }
    }

    // 2. SOURCE BALANCING
    if (process.env.DEBUG_MODE === 'true') log.info('SOURCE_BALANCING_START');

    // Sort signals by buyer-intent quality ranking
    const stageVal = { 'decision': 4, 'evaluation': 3, 'consideration': 2, 'awareness': 1, 'none': 0 };
    enrichedSignals.sort((a, b) => {
        // Priority 1: Human switching pain
        const aSwitch = a.switchSignals?.switchingDetected ? 1 : 0;
        const bSwitch = b.switchSignals?.switchingDetected ? 1 : 0;
        if (bSwitch !== aSwitch) return bSwitch - aSwitch;
        // Priority 2: Pricing complaints
        const aPrice = a.painSignals?.painTypes?.includes('pricing') ? 1 : 0;
        const bPrice = b.painSignals?.painTypes?.includes('pricing') ? 1 : 0;
        if (bPrice !== aPrice) return bPrice - aPrice;
        // Priority 3: Vendor comparison
        const aComp = a.competitorSignals?.hasCompetitiveSignal ? 1 : 0;
        const bComp = b.competitorSignals?.hasCompetitiveSignal ? 1 : 0;
        if (bComp !== aComp) return bComp - aComp;
        // Priority 4: Recommendation requests (evaluation stage)
        const aStage = stageVal[a.buyingStage] || 0;
        const bStage = stageVal[b.buyingStage] || 0;
        if (bStage !== aStage) return bStage - aStage;
        // Priority 5: Intent score tiebreaker
        if (b.intentScore !== a.intentScore) return b.intentScore - a.intentScore;
        // Priority 6: Freshness
        return (a.contentAgeDays || 0) - (b.contentAgeDays || 0);
    });

    // Calculate available signals per source
    const availableBySource = {};
    for (const signal of enrichedSignals) {
        if (signal.signalQuality === 'REJECT') continue;
        availableBySource[signal.source] = (availableBySource[signal.source] || 0) + 1;
    }
    if (process.env.DEBUG_MODE === 'true') log.info('SOURCE_AVAILABLE:', availableBySource);

    // Apply diversity quotas with minimum guarantees
    const totalAvailable = Object.values(availableBySource).reduce((a, b) => a + b, 0);
    const sourceQuotas = {
        'reddit':      Math.max(3, Math.min(Math.ceil(totalAvailable * 0.35), availableBySource['reddit']      || 0)),
        'linkedin':    Math.max(2, Math.min(Math.ceil(totalAvailable * 0.25), availableBySource['linkedin']    || 0)),
        'g2':          Math.max(2, Math.min(Math.ceil(totalAvailable * 0.20), availableBySource['g2']          || 0)),
        'hackernews':  Math.max(2, Math.min(Math.ceil(totalAvailable * 0.15), availableBySource['hackernews']  || 0)),
        'github':      Math.max(2, Math.min(Math.ceil(totalAvailable * 0.15), availableBySource['github']      || 0)),
        'news':        Math.max(1, Math.min(Math.ceil(totalAvailable * 0.10), availableBySource['news']        || 0)),
    };
    if (process.env.DEBUG_MODE === 'true') log.info('SOURCE_QUOTAS:', sourceQuotas);

    const sourceCounts = {};
    const truncatedSignals = [];

    for (const signal of enrichedSignals) {
        if (signal.signalQuality === 'REJECT') continue;
        
        const src = signal.source;
        if (!sourceCounts[src]) sourceCounts[src] = 0;
        
        if (sourceCounts[src] < (sourceQuotas[src] || 1)) {
            truncatedSignals.push(signal);
            sourceCounts[src]++;
        } else {
            log.debug(`Truncated signal from ${src} due to source diversity quota.`);
        }
    }
    
    // Replace enrichedSignals with the truncated, balanced subset
    const finalSignals = [];
    for (const signal of truncatedSignals) {
        if (!signal || !signal.title || !signal.source || !signal.company || !signal.url || signal.title.toLowerCase().includes('undefined')) {
            log.warning('DROPPED_INVALID_SIGNAL');
            continue;
        }
        finalSignals.push(signal);
    }

    // Log final balance
    const finalSourceCounts = {};
    for (const signal of finalSignals) {
        finalSourceCounts[signal.source] = (finalSourceCounts[signal.source] || 0) + 1;
    }
    if (process.env.DEBUG_MODE === 'true') log.info('SOURCE_BALANCING_RESULT:', finalSourceCounts);
    
    const totalFinal = finalSignals.length;
    if (totalFinal > 0) {
        for (const [src, count] of Object.entries(finalSourceCounts)) {
            if ((count / totalFinal) > 0.80) {
                log.warning(`SOURCE_DIVERSITY_WARNING: ${src} dominates at ${Math.round((count / totalFinal) * 100)}%`);
            }
        }
    }

    return finalSignals;
}
