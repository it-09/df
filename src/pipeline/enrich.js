// Pipeline Stage 4: Enrichment, ICP matching, and Quality-Based Ranking
// No forced source quotas — quality dictates final distribution.
import { log } from 'apify';
import { generateOutreachAngle, calculateICPFit, generateCrmReady } from '../classifiers/crm.js';
import { generateSignalHash } from '../utils/monitor.js';
import { MAX_RESULTS_PER_QUERY } from '../constants.js';

/**
 * Enrich qualified signals with company profiles, CRM formats, ICP fits.
 * Quality dictates the final distribution — no forced source quotas.
 *
 * @param {Array} enrichedSignals - Signals from qualify stage
 * @param {Object} companyProfiles - Company profiles cache
 * @param {Set} seenHashes - Set of previously seen signal hashes
 * @param {string} monitoringMode - 'off' | 'delta' | etc
 * @param {string[]} validCompanies - Target companies
 * @param {number} maxResults - Maximum results to return
 * @returns {Array} - Enriched and ranked signals
 */
export function enrichSignals(enrichedSignals, companyProfiles, seenHashes, monitoringMode, validCompanies, maxResults = MAX_RESULTS_PER_QUERY) {
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

    // 2. GLOBAL QUALITY RANKING — no source quotas
    // Sort by buyer-intent quality, then take the top N
    const stageVal = { 'decision': 4, 'evaluation': 3, 'consideration': 2, 'awareness': 1, 'none': 0 };
    enrichedSignals.sort((a, b) => {
        // Priority 1: Reject signals first (will be filtered out)
        const aReject = a.signalQuality === 'REJECT' ? 1 : 0;
        const bReject = b.signalQuality === 'REJECT' ? 1 : 0;
        if (aReject !== bReject) return aReject - bReject;

        // Priority 2: Human switching pain
        const aSwitch = a.switchSignals?.switchingDetected ? 1 : 0;
        const bSwitch = b.switchSignals?.switchingDetected ? 1 : 0;
        if (bSwitch !== aSwitch) return bSwitch - aSwitch;

        // Priority 3: Pricing complaints
        const aPrice = a.painSignals?.painTypes?.includes('pricing') ? 1 : 0;
        const bPrice = b.painSignals?.painTypes?.includes('pricing') ? 1 : 0;
        if (bPrice !== aPrice) return bPrice - aPrice;

        // Priority 4: Vendor comparison
        const aComp = a.competitorSignals?.hasCompetitiveSignal ? 1 : 0;
        const bComp = b.competitorSignals?.hasCompetitiveSignal ? 1 : 0;
        if (bComp !== aComp) return bComp - aComp;

        // Priority 5: Buying stage
        const aStage = stageVal[a.buyingStage] || 0;
        const bStage = stageVal[b.buyingStage] || 0;
        if (bStage !== aStage) return bStage - aStage;

        // Priority 6: LLM confidence (higher = better)
        const aConf = a.llmConfidence || 0;
        const bConf = b.llmConfidence || 0;
        if (bConf !== aConf) return bConf - aConf;

        // Priority 7: Intent score tiebreaker
        if (b.intentScore !== a.intentScore) return b.intentScore - a.intentScore;

        // Priority 8: Freshness
        return (a.contentAgeDays || 0) - (b.contentAgeDays || 0);
    });

    // 3. Filter out rejected signals and take top N by quality
    const qualifiedSignals = enrichedSignals.filter(s => s.signalQuality !== 'REJECT');
    const finalSignals = [];

    for (const signal of qualifiedSignals) {
        if (finalSignals.length >= maxResults) break;

        // Basic validity check
        if (!signal || !signal.title || !signal.source || !signal.company || !signal.url || signal.title.toLowerCase().includes('undefined')) {
            log.debug('DROPPED_INVALID_SIGNAL');
            continue;
        }

        finalSignals.push(signal);
    }

    // Log final distribution
    const finalSourceCounts = {};
    for (const signal of finalSignals) {
        finalSourceCounts[signal.source] = (finalSourceCounts[signal.source] || 0) + 1;
    }
    if (process.env.DEBUG_MODE === 'true') {
        log.info('QUALITY_RANKING_RESULT:', finalSourceCounts);
    }

    // Warn if any source dominates (but don't enforce quotas)
    const totalFinal = finalSignals.length;
    if (totalFinal > 0) {
        for (const [src, count] of Object.entries(finalSourceCounts)) {
            if ((count / totalFinal) > 0.80) {
                log.warning(`SOURCE_DIVERSITY_WARNING: ${src} dominates at ${Math.round((count / totalFinal) * 100)}% — consider adjusting scrapers if this is unexpected.`);
            }
        }
    }

    return finalSignals;
}
