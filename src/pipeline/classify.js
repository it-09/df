// Pipeline Stage 2: Heuristic Classification & Noise Rejection
// New pipeline order: Topic Relevance → Negative Filter → Commercial Intent → Pain → Buying Intent
import { log } from 'apify';
import { franc, francAll } from 'franc-min';
import { analyzeAspectSentiment } from '../classifiers/sentiment.js';
import { detectBuyingSignals, detectCompetitors, predictBuyingStage, detectNoise } from '../classifiers/intent.js';
import { extractPersona, isDecisionMaker, scorePersonaInfluence } from '../classifiers/persona.js';
import { detectPainSignals } from '../classifiers/pain.js';
import { detectSwitchingSignals } from '../classifiers/switching.js';
import { calculateIntentScore, calculateLeadPriority } from '../classifiers/leadScorer.js';
import { calculateCommercialRelevance } from '../classifiers/relevance.js';
import { checkTopicRelevance } from '../classifiers/topicRelevance.js';
import { filterNegatives } from '../classifiers/negativeFilter.js';
import { deduplicateSignals, calculateConfidence, cleanText } from '../utils/normalizer.js';

/**
 * Helper to create a rejected signal object with consistent fields.
 */
function createRejectedSignal(signal, reason) {
    return {
        ...signal,
        rejectionReason: reason,
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
        commercialRelevanceLevel: 'LOW',
    };
}

/**
 * Build a stable identifier for cross-company deduplication.
 * Priority: URL > GitHub repo > HN item ID > Reddit post ID > null
 * @param {Object} signal - The signal to identify
 * @returns {string|null} - Stable identifier or null
 */
function buildStableIdentifier(signal) {
    // 1. Canonical URL (most reliable)
    if (signal.url) {
        try {
            const urlObj = new URL(signal.url);
            urlObj.search = '';
            urlObj.hash = '';
            return `url:${urlObj.toString().toLowerCase().replace(/\/$/, '')}`;
        } catch {
            // Invalid URL, fall through
        }
    }

    // 2. GitHub repository (owner/repo)
    if (signal.source === 'github' && signal.repository) {
        return `github:${signal.repository.toLowerCase()}`;
    }

    // 3. HN item ID
    if (signal.source === 'hackernews' && signal.url) {
        const hnMatch = signal.url.match(/item\?id=(\d+)/);
        if (hnMatch) return `hn:${hnMatch[1]}`;
    }

    // 4. Reddit post ID
    if (signal.source === 'reddit' && signal.url) {
        const redditMatch = signal.url.match(/\/comments\/([a-z0-9]+)/i);
        if (redditMatch) return `reddit:${redditMatch[1]}`;
    }

    // No stable identifier — allow through (content dedup handles this)
    return null;
}

/**
 * Deduplicate and heuristically classify collected signals.
 * Pipeline order: Topic Relevance → Negative Filter → Commercial Intent → Pain → Buying Intent
 *
 * @param {Array} allSignals - Raw signals collected
 * @param {string[]} validCompanies - Target companies list
 * @param {string[]} knownCompetitors - Known competitor names list
 * @param {Object} topicProfile - Dynamic topic profile from buildTopicProfile()
 * @param {boolean} skipLanguageFilter - Skip language detection
 * @returns {Array} - Heuristically classified signals
 */
export function classifySignals(allSignals, validCompanies, knownCompetitors, topicProfile, skipLanguageFilter = false) {
    // Deduplicate signals (content fingerprint)
    const uniqueSignals = deduplicateSignals(allSignals);
    log.info(`After deduplication: ${uniqueSignals.length} signals`);

    // Cross-company deduplication (stable identifiers)
    const seenIdentifiers = new Map();
    const crossCompanyDeduped = [];
    for (const signal of uniqueSignals) {
        const identifier = buildStableIdentifier(signal);
        if (identifier) {
            const existingCompany = seenIdentifiers.get(identifier);
            if (existingCompany && existingCompany !== signal.company) {
                log.debug(`CROSS_COMPANY_DEDUP: "${(signal.title || '').substring(0, 50)}" already seen for ${existingCompany}, skipping for ${signal.company}`);
                continue;
            }
            seenIdentifiers.set(identifier, signal.company);
        }
        crossCompanyDeduped.push(signal);
    }
    log.info(`After cross-company deduplication: ${crossCompanyDeduped.length} signals (removed ${uniqueSignals.length - crossCompanyDeduped.length})`);

    let topicRejected = 0;
    let negativeRejected = 0;
    let intentRejected = 0;
    let languageRejected = 0;
    let noiseRejected = 0;

    log.info('Running Stage 2 Heuristic Filtering (Topic → Negative → Commercial Intent)...');
    const classified = crossCompanyDeduped.map(signal => {
        // --- STAGE 1: Topic Relevance (SOFT SIGNAL) ---
        // Topic relevance is used to boost score, not as a hard gate.
        // The negative filter and commercial intent do the real filtering.
        let topicScore = 0;
        let matchedTopicTerms = [];
        if (topicProfile) {
            const topicResult = checkTopicRelevance(signal, topicProfile);
            topicScore = topicResult.topicScore;
            matchedTopicTerms = topicResult.matchedTerms;
        }

        // --- STAGE 2: Negative Content Filter ---
        // Reject marketplaces, personal stories, memes, generic AI, academic, etc.
        const negativeResult = filterNegatives(signal);
        if (negativeResult.isFiltered) {
            negativeRejected++;
            return createRejectedSignal(signal, negativeResult.filterReason);
        }

        // --- STAGE 3: Language Detection ---
        if (!skipLanguageFilter) {
            const fullText = cleanText(`${signal.title || ''} ${signal.content || ''}`);
            const allLanguages = francAll(fullText, { minLength: 10 });
            const topLang = allLanguages[0];
            if (topLang && topLang[0] !== 'eng' && topLang[1] > 0.7) {
                languageRejected++;
                return createRejectedSignal(signal, 'non_english_content');
            }
        }

        const fullText = `${signal.title || ''} ${signal.content || ''}`;
        const cleanedText = cleanText(fullText);

        const signalDate = signal.createdAt ? new Date(signal.createdAt) : new Date();
        const daysOld = Math.max(0, Math.floor((new Date() - signalDate) / (1000 * 60 * 60 * 24)));

        // --- STAGE 4: Noise Detection ---
        const noiseData = detectNoise(cleanedText);
        if (noiseData.isNoise) {
            noiseRejected++;
            return createRejectedSignal(signal, noiseData.reason);
        }

        // --- STAGE 5: Commercial Intent Classification ---
        const buyingSignals = detectBuyingSignals(cleanedText);
        const hasCommercialIntent =
            buyingSignals.hasFrustrationSignal ||
            buyingSignals.hasEvaluationSignal ||
            buyingSignals.hasBudgetSignal ||
            buyingSignals.hasDecisionSignal ||
            buyingSignals.hasTechnicalSignal;

        if (!hasCommercialIntent) {
            intentRejected++;
            return createRejectedSignal(signal, 'Generic mention lacking commercial or pain indicators');
        }

        // --- STAGE 6: Staleness Filter ---
        if (daysOld > 90 && !buyingSignals.hasFrustrationSignal && !buyingSignals.hasEvaluationSignal) {
            intentRejected++;
            return createRejectedSignal(signal, `Content is too old (${daysOld} days) and lacks explicit switching/evaluation intent`);
        }

        // --- STAGE 7: Full Classification ---
        const sentiment = analyzeAspectSentiment(cleanedText, signal.company, knownCompetitors);
        const competitorSignals = detectCompetitors(cleanedText, knownCompetitors);
        const personaSignals = extractPersona(cleanedText);
        const buyingStage = predictBuyingStage(buyingSignals, sentiment);
        const painSignals = detectPainSignals(cleanedText);
        const switchSignals = detectSwitchingSignals(cleanedText, validCompanies, knownCompetitors, fullText);

        const { commercialRelevanceScore, commercialRelevanceLevel } = calculateCommercialRelevance(
            cleanedText, signal.title, signal.author, { buyingSignals, painSignals, switchSignals, buyingStage }
        );

        const { intentScore: baseIntentScore, intentLevel, painComboBoost } = calculateIntentScore({
            buyingSignals, sentiment, personaSignals, painSignals, switchSignals, buyingStage, competitorSignals
        }, signal.source, signal.subreddit || signal.sourceCategory, daysOld, noiseData.isNoise, signal.repoStars || 0);

        // Boost intent score for topic-relevant signals (soft signal, not a gate)
        const topicBoost = Math.round(topicScore * 15); // Max +15 points for perfect topic match
        const intentScore = Math.min(100, baseIntentScore + topicBoost);

        // --- STAGE 8: Quality Assignment ---
        let signalQuality = intentScore >= 60 ? 'HIGH' : (intentScore >= 30 ? 'MEDIUM' : 'LOW');

        const leadPriority = calculateLeadPriority({
            intentScore, painSignals, switchSignals, personaSignals, buyingSignals, competitorSignals, buyingStage, commercialRelevanceLevel
        });

        return {
            ...signal,
            rejectionReason: '',
            signalQuality,
            sentiment: { score: sentiment.overall.score, label: sentiment.overall.label, towardCompany: sentiment.towardCompany, towardCompetitors: sentiment.towardCompetitors },
            buyingSignals: { hasBudgetSignal: buyingSignals.hasBudgetSignal, hasTimelineSignal: buyingSignals.hasTimelineSignal, hasTechnicalSignal: buyingSignals.hasTechnicalSignal, hasEvaluationSignal: buyingSignals.hasEvaluationSignal, hasDecisionSignal: buyingSignals.hasDecisionSignal, hasFrustrationSignal: buyingSignals.hasFrustrationSignal, confidence: buyingSignals.confidence, signals: buyingSignals.signals },
            competitorSignals: { hasCompetitiveSignal: competitorSignals.hasCompetitiveSignal, competitors: competitorSignals.competitors },
            personaSignals: { jobTitles: personaSignals.jobTitles, departments: personaSignals.departments, seniorityLevels: personaSignals.senityLevels, isDecisionMaker: isDecisionMaker(personaSignals), influenceScore: scorePersonaInfluence(personaSignals) },
            buyingStage,
            confidence: calculateConfidence(signal),
            painSignals: { hasPainSignal: painSignals.hasPainSignal, painTypes: painSignals.painTypes, severity: painSignals.severity, confidence: painSignals.confidence, compoundComboMatched: painSignals.compoundComboMatched },
            switchSignals: { switchingDetected: switchSignals.switchingDetected, switchingFrom: switchSignals.switchingFrom, switchingTo: switchSignals.switchingTo, confidence: switchSignals.confidence, stage: switchSignals.stage },
            intentScore,
            intentLevel,
            leadPriority,
            commercialRelevanceScore,
            commercialRelevanceLevel,
            painComboBoost,
            topicRelevance: { score: topicScore, matchedTerms: matchedTopicTerms }
        };
    });

    // Log filtering statistics
    log.info(`Stage 2 filtering summary: topic_rejected=${topicRejected}, negative_rejected=${negativeRejected}, language_rejected=${languageRejected}, noise_rejected=${noiseRejected}, intent_rejected=${intentRejected}`);

    return classified;
}
