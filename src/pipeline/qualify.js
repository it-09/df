// Pipeline Stage 3: LLM Truth Layer / Buyer Qualification
import { log } from 'apify';
import { evaluateSignalWithLLM } from '../classifiers/llmEvaluator.js';
import { generateExplainability } from '../classifiers/crm.js';

/**
 * Qualify candidate signals using the LLM Truth Layer.
 * Rejects false positives and refines buyer qualification signals.
 * 
 * @param {Array} heuristicSignals - Classified signals from Stage 2
 * @param {string|null} openaiApiKey - OpenAI API Key
 * @param {Object} forensics - Object to track forensics counts
 * @returns {Promise<Array>} - Qualified signals
 */
export async function qualifySignals(heuristicSignals, openaiApiKey, forensics = {}) {
    if (!openaiApiKey) {
        log.warning('------------------------------------------------------');
        log.warning('⚠️ LLM buyer qualification disabled (No OpenAI API Key).');
        log.warning('Results may contain false positives (listicles, spam).');
        log.warning('Add an API key to enable production CRM readiness.');
        log.warning('------------------------------------------------------');
    } else {
        log.info('Running Stage 3 LLM Truth Layer on top candidates...');
    }

    const enrichedSignals = [];
    const BATCH_SIZE = 10;
    
    // We only send candidates >= 40 to the LLM
    const candidates = heuristicSignals.filter(s => s.intentScore >= 40);
    const nonCandidates = heuristicSignals.filter(s => s.intentScore < 40);
    candidates.forEach(s => { 
        forensics.POST_FILTER_COUNTS = forensics.POST_FILTER_COUNTS || {};
        forensics.POST_FILTER_COUNTS[s.source] = (forensics.POST_FILTER_COUNTS[s.source] || 0) + 1; 
    });

    if (openaiApiKey && candidates.length > 0) {
        log.info(`Filtered down to ${candidates.length} candidates out of ${heuristicSignals.length} signals.`);
        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
            const batch = candidates.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (signal) => {
                const llmResult = await evaluateSignalWithLLM(signal, openaiApiKey);
                
                // Override heuristic data if LLM evaluates successfully
                let finalScore = signal.intentScore;
                let leadPriority = signal.leadPriority;
                let whyHighIntent = '';
                
                if (llmResult.isGenuineBuyer) {
                    forensics.LLM_ACCEPT_COUNTS = forensics.LLM_ACCEPT_COUNTS || {};
                    forensics.LLM_ACCEPT_COUNTS[signal.source] = (forensics.LLM_ACCEPT_COUNTS[signal.source] || 0) + 1;
                    finalScore = llmResult.intentScore;
                    if (finalScore >= 80) leadPriority = 'URGENT';
                    else if (finalScore >= 60) leadPriority = 'HIGH';
                    else leadPriority = 'MEDIUM';
                    whyHighIntent = llmResult.explanation;
                    signal.intentLevel = finalScore >= 80 ? 'HIGH' : finalScore >= 40 ? 'MEDIUM' : 'LOW';
                    
                    if (llmResult.painPoints.length > 0) {
                        signal.painSignals.hasPainSignal = true;
                        signal.painSignals.painTypes = llmResult.painPoints;
                    }
                    if (llmResult.switchingFrom || llmResult.switchingTo) {
                        signal.switchSignals.switchingDetected = true;
                        signal.switchSignals.switchingFrom = llmResult.switchingFrom;
                        signal.switchSignals.switchingTo = llmResult.switchingTo;
                    }
                    if (llmResult.personas.length > 0) {
                        signal.personaSignals.jobTitles = llmResult.personas;
                    }
                } else {
                    // LLM rejected it as noise
                    finalScore = 0;
                    leadPriority = 'LOW';
                    signal.commercialRelevanceLevel = 'LOW';
                    signal.commercialRelevanceScore = 0;
                    signal.intentLevel = 'LOW';
                    signal.buyingStage = 'awareness';
                    whyHighIntent = 'Rejected by LLM Truth Layer';
                }

                signal.intentScore = finalScore;
                signal.leadPriority = leadPriority;
                signal.whyHighIntent = whyHighIntent;
                return signal;
            }));
            
            enrichedSignals.push(...batchResults);
            log.info(`Evaluated ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length} candidates...`);
        }
    } else {
        // Fallback: just use heuristic candidates
        for (const signal of candidates) {
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
            signal.whyHighIntent = generateExplainability(crmData).join(' + ');
            enrichedSignals.push(signal);
        }
    }

    // --- WHY-HIGH-INTENT V3: Forensic logging ---
    let whyFallbackCount = 0;
    let whyGeneratedCount = 0;
    for (const signal of enrichedSignals) {
        if (signal.whyHighIntent && signal.whyHighIntent.includes('general buying signals detected') && !signal.whyHighIntent.includes('+')) {
            whyFallbackCount++;
        } else if (signal.whyHighIntent && signal.whyHighIntent.length > 0) {
            whyGeneratedCount++;
        }
    }
    
    if (process.env.DEBUG_MODE === 'true') {
        log.info(`WHY_HIGH_INTENT_GENERATED: ${whyGeneratedCount}`);
        log.info(`WHY_HIGH_INTENT_FALLBACK: ${whyFallbackCount}`);
        if (enrichedSignals.length > 0) {
            const fallbackPct = Math.round((whyFallbackCount / enrichedSignals.length) * 100);
            log.info(`WHY_HIGH_INTENT_FALLBACK_PCT: ${fallbackPct}%`);
            if (fallbackPct > 10) {
                log.warning(`WHY_HIGH_INTENT quality warning: ${fallbackPct}% of rows using generic fallback (target: <10%)`);
            }
        }
    }

    // Add back the non-candidates (they just stay LOW)
    for (const signal of nonCandidates) {
        signal.whyHighIntent = '';
        enrichedSignals.push(signal);
    }

    return enrichedSignals;
}
