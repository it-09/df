// Pipeline Stage 2: Heuristic Classification & Noise Rejection
import { log } from 'apify';
import { franc, francAll } from 'franc-min';
import { analyzeAspectSentiment } from '../classifiers/sentiment.js';
import { detectBuyingSignals, detectCompetitors, predictBuyingStage, detectNoise } from '../classifiers/intent.js';
import { extractPersona, isDecisionMaker, scorePersonaInfluence } from '../classifiers/persona.js';
import { detectPainSignals } from '../classifiers/pain.js';
import { detectSwitchingSignals } from '../classifiers/switching.js';
import { calculateIntentScore, calculateLeadPriority } from '../classifiers/leadScorer.js';
import { calculateCommercialRelevance } from '../classifiers/relevance.js';
import { deduplicateSignals, calculateConfidence, cleanText } from '../utils/normalizer.js';

/**
 * Deduplicate and heuristically classify collected signals.
 * Filters out noise and ranks remaining candidate signals.
 * 
 * @param {Array} allSignals - Raw signals collected
 * @param {string[]} validCompanies - Target companies list
 * @param {string[]} knownCompetitors - Known competitor names list
 * @returns {Array} - Heuristically classified signals
 */
export function classifySignals(allSignals, validCompanies, knownCompetitors, skipLanguageFilter = false) {
    // Deduplicate signals
    const uniqueSignals = deduplicateSignals(allSignals);
    log.info(`After deduplication: ${uniqueSignals.length} signals`);

    log.info('Running Stage 1 & 2 Heuristic Filtering...');
    return uniqueSignals.map(signal => {
        // Language detection step
        if (!skipLanguageFilter) {
            const fullText = cleanText(`${signal.title || ''} ${signal.content || ''}`);
            // Get langauge with confidence - use francAll
            const allLanguages = francAll(fullText, { minLength: 10 });
            const topLang = allLanguages[0]; // top result has highest confidence
            // Check if top language is not 'eng' with confidence > 0.7
            if (topLang && topLang[0] !== 'eng' && topLang[1] > 0.7) {
                return {
                    ...signal,
                    rejectionReason: 'non_english_content',
                    signalQuality: 'REJECT',
                    sentiment: null,
                    buyingSignals: null,
                    competitorSignals: null,
                    personaSignals: null,
                    buyingStage: null,
                    confidence: 0,
                    painSignals: null,
                    switchSignals: null,
                    intentScore: 0,
                    intentLevel: null,
                    leadPriority: 'LOW',
                    commercialRelevanceScore: 0,
                    commercialRelevanceLevel: 'LOW'
                };
            }
        }
        const fullText = `${signal.title || ''} ${signal.content || ''}`;
        const cleanedText = cleanText(fullText);

        const signalDate = signal.createdAt ? new Date(signal.createdAt) : new Date();
        const daysOld = Math.max(0, Math.floor((new Date() - signalDate) / (1000 * 60 * 60 * 24)));
        const noiseData = detectNoise(cleanedText);

        const sentiment = analyzeAspectSentiment(cleanedText, signal.company, knownCompetitors);
        const buyingSignals = detectBuyingSignals(cleanedText);
        const competitorSignals = detectCompetitors(cleanedText, knownCompetitors);
        const personaSignals = extractPersona(cleanedText);
        const buyingStage = predictBuyingStage(buyingSignals, sentiment);
        const painSignals = detectPainSignals(cleanedText);
        const switchSignals = detectSwitchingSignals(cleanedText, validCompanies, knownCompetitors);

        const { commercialRelevanceScore, commercialRelevanceLevel } = calculateCommercialRelevance(
            cleanedText, signal.title, signal.author, { buyingSignals, painSignals, switchSignals, buyingStage }
        );

        const { intentScore, intentLevel, painComboBoost } = calculateIntentScore({
            buyingSignals, sentiment, personaSignals, painSignals, switchSignals, buyingStage, competitorSignals
        }, signal.source, signal.subreddit || signal.sourceCategory, daysOld, noiseData.isNoise, signal.repoStars || 0);

        let rejectionReason = '';
        const hasCommercialPainOrIntent = 
            buyingSignals.hasFrustrationSignal || 
            buyingSignals.hasEvaluationSignal || 
            switchSignals.switchingDetected || 
            buyingSignals.hasBudgetSignal || 
            buyingSignals.hasTechnicalSignal || 
            buyingSignals.hasDecisionSignal || 
            competitorSignals.hasCompetitiveSignal;

        if (noiseData.isNoise) {
            rejectionReason = noiseData.reason;
        } else if (!hasCommercialPainOrIntent) {
            rejectionReason = `Generic mention lacking commercial or pain indicators`;
        } else if (daysOld > 90 && !switchSignals.switchingDetected && !buyingSignals.hasFrustrationSignal && !buyingSignals.hasEvaluationSignal) {
            rejectionReason = `Content is too old (${daysOld} days) and lacks explicit switching/evaluation intent`;
        }

        let signalQuality = intentScore >= 60 ? 'HIGH' : (intentScore >= 30 ? 'MEDIUM' : 'LOW');
        if (rejectionReason) {
            signalQuality = 'REJECT';
        }

        const leadPriority = calculateLeadPriority({
            intentScore, painSignals, switchSignals, personaSignals, buyingSignals, competitorSignals, buyingStage, commercialRelevanceLevel
        });

        return {
            ...signal,
            rejectionReason,
            signalQuality,
            sentiment: { score: sentiment.overall.score, label: sentiment.overall.label, towardCompany: sentiment.towardCompany, towardCompetitors: sentiment.towardCompetitors },
            buyingSignals: { hasBudgetSignal: buyingSignals.hasBudgetSignal, hasTimelineSignal: buyingSignals.hasTimelineSignal, hasTechnicalSignal: buyingSignals.hasTechnicalSignal, hasEvaluationSignal: buyingSignals.hasEvaluationSignal, hasDecisionSignal: buyingSignals.hasDecisionSignal, confidence: buyingSignals.confidence, signals: buyingSignals.signals },
            competitorSignals: { hasCompetitiveSignal: competitorSignals.hasCompetitiveSignal, competitors: competitorSignals.competitors },
            personaSignals: { jobTitles: personaSignals.jobTitles, departments: personaSignals.departments, seniorityLevels: personaSignals.seniorityLevels, isDecisionMaker: isDecisionMaker(personaSignals), influenceScore: scorePersonaInfluence(personaSignals) },
            buyingStage,
            confidence: calculateConfidence(signal),
            painSignals: { hasPainSignal: painSignals.hasPainSignal, painTypes: painSignals.painTypes, severity: painSignals.severity, confidence: painSignals.confidence, compoundComboMatched: painSignals.compoundComboMatched },
            switchSignals: { switchingDetected: switchSignals.switchingDetected, switchingFrom: switchSignals.switchingFrom, switchingTo: switchSignals.switchingTo, confidence: switchSignals.confidence, stage: switchSignals.stage },
            intentScore,
            intentLevel,
            leadPriority,
            commercialRelevanceScore,
            commercialRelevanceLevel,
            painComboBoost
        };
    });
}
