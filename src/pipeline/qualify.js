// Pipeline Stage 3: LLM Truth Layer / Buyer Qualification
// The LLM acts as the FINAL validation layer, not the first filter.
// It receives pre-filtered candidates and applies strict quality gating.
import { log } from 'apify';
import { evaluateSignalWithLLM } from '../classifiers/llmEvaluator.js';
import { generateExplainability } from '../classifiers/crm.js';
import { MIN_CONFIDENCE_THRESHOLD, INTENT_SCORE_LLM_GATE, LLM_BATCH_SIZE } from '../constants.js';

/**
 * Qualify candidate signals using the LLM Truth Layer.
 * Rejects false positives and refines buyer qualification signals.
 *
 * @param {Array} heuristicSignals - Classified signals from Stage 2
 * @param {string|null} openaiApiKey - OpenAI API Key
 * @param {string} searchQuery - The original search query for LLM context
 * @param {Object} forensics - Object to track forensics counts
 * @returns {Promise<Array>} - Qualified signals
 */
export async function qualifySignals(heuristicSignals, openaiApiKey, searchQuery = '', forensics = {}) {
    if (!openaiApiKey) {
        log.warning('------------------------------------------------------');
        log.warning('LLM buyer qualification disabled (No OpenAI API Key).');
        log.warning('Results may contain false positives (listicles, spam).');
        log.warning('Add an API key to enable production CRM readiness.');
        log.warning('------------------------------------------------------');
    } else {
        log.info('Running Stage 3 LLM Truth Layer on top candidates...');
    }

    const enrichedSignals = [];

    // Only send candidates with intentScore >= LLM gate to the LLM
    const candidates = heuristicSignals.filter(s => s.intentScore >= INTENT_SCORE_LLM_GATE && s.signalQuality !== 'REJECT');
    const nonCandidates = heuristicSignals.filter(s => s.intentScore < INTENT_SCORE_LLM_GATE || s.signalQuality === 'REJECT');

    candidates.forEach(s => {
        forensics.POST_FILTER_COUNTS = forensics.POST_FILTER_COUNTS || {};
        forensics.POST_FILTER_COUNTS[s.source] = (forensics.POST_FILTER_COUNTS[s.source] || 0) + 1;
    });

    if (openaiApiKey && candidates.length > 0) {
        log.info(`Filtered down to ${candidates.length} candidates out of ${heuristicSignals.length} signals.`);
        for (let i = 0; i < candidates.length; i += LLM_BATCH_SIZE) {
            const batch = candidates.slice(i, i + LLM_BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (signal) => {
                const llmResult = await evaluateSignalWithLLM(signal, openaiApiKey, searchQuery);

                let finalScore = signal.intentScore;
                let leadPriority = signal.leadPriority;
                let whyHighIntent = '';

                if (llmResult.isGenuineBuyer) {
                    // LLM accepted with sufficient confidence
                    forensics.LLM_ACCEPT_COUNTS = forensics.LLM_ACCEPT_COUNTS || {};
                    forensics.LLM_ACCEPT_COUNTS[signal.source] = (forensics.LLM_ACCEPT_COUNTS[signal.source] || 0) + 1;

                    finalScore = llmResult.intentScore;
                    if (finalScore >= 80) leadPriority = 'URGENT';
                    else if (finalScore >= 60) leadPriority = 'HIGH';
                    else leadPriority = 'MEDIUM';

                    whyHighIntent = llmResult.explanation;
                    signal.intentLevel = finalScore >= 80 ? 'HIGH' : finalScore >= 40 ? 'MEDIUM' : 'LOW';
                    signal.buyingStage = llmResult.buyerStage || signal.buyingStage;

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
                    // LLM rejected it as noise or below confidence threshold
                    forensics.LLM_REJECT_COUNTS = forensics.LLM_REJECT_COUNTS || {};
                    forensics.LLM_REJECT_COUNTS[signal.source] = (forensics.LLM_REJECT_COUNTS[signal.source] || 0) + 1;

                    finalScore = 0;
                    leadPriority = 'LOW';
                    signal.commercialRelevanceLevel = 'LOW';
                    signal.commercialRelevanceScore = 0;
                    signal.intentLevel = 'LOW';
                    signal.buyingStage = 'awareness';
                    signal.rejectionReason = `LLM rejected: ${llmResult.explanation}`;
                    signal.signalQuality = 'REJECT';
                    whyHighIntent = '';
                }

                signal.intentScore = finalScore;
                signal.leadPriority = leadPriority;
                signal.whyHighIntent = whyHighIntent;
                signal.llmConfidence = llmResult.confidence;
                return signal;
            }));

            enrichedSignals.push(...batchResults);
            log.info(`Evaluated ${Math.min(i + LLM_BATCH_SIZE, candidates.length)}/${candidates.length} candidates...`);
        }
    } else if (!openaiApiKey && candidates.length > 0) {
        // Fallback: just use heuristic candidates without LLM
        log.info(`LLM disabled. Using ${candidates.length} heuristic candidates.`);
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
            signal.llmConfidence = null;
            enrichedSignals.push(signal);
        }
    }

    // Log LLM forensics
    if (openaiApiKey) {
        const totalAccepted = Object.values(forensics.LLM_ACCEPT_COUNTS || {}).reduce((a, b) => a + b, 0);
        const totalRejected = Object.values(forensics.LLM_REJECT_COUNTS || {}).reduce((a, b) => a + b, 0);
        log.info(`LLM evaluation results: accepted=${totalAccepted}, rejected=${totalRejected}`);
    }

    // Add back the non-candidates (they stay LOW priority, not output)
    for (const signal of nonCandidates) {
        signal.whyHighIntent = '';
        enrichedSignals.push(signal);
    }

    return enrichedSignals;
}
