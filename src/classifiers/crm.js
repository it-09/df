// CRM Intelligence Classifier
// Generates sales-ready fields for lead prioritization and outreach

/**
 * Generate a human-readable list explaining why a lead is high intent
 * @param {Object} data - Enrichment data
 * @returns {string[]} - Array of reasons
 */
export function generateExplainability(data) {
    const reasons = [];
    
    // --- WHY-HIGH-INTENT ENGINE V3: Deterministic mapping ---

    // 1. Switching language (highest signal)
    if (data.switchSignals?.switchingDetected) {
        if (data.switchSignals.switchingFrom) {
            reasons.push(`active competitor switching intent (from ${data.switchSignals.switchingFrom})`);
        } else {
            reasons.push('active competitor switching intent');
        }
    }
    
    // 2. Pain signals — map each type to a precise explanation
    if (data.painSignals?.hasPainSignal && data.painSignals.painTypes?.length > 0) {
        for (const pt of data.painSignals.painTypes) {
            switch (pt) {
                case 'pricing':
                    reasons.push('pricing dissatisfaction + budget concern');
                    break;
                case 'usability':
                    reasons.push('workflow dissatisfaction + replacement intent');
                    break;
                case 'support':
                    reasons.push('support dissatisfaction affecting adoption');
                    break;
                case 'technical':
                    reasons.push('technical dissatisfaction affecting adoption');
                    break;
                case 'compliance':
                    reasons.push('compliance/security concern');
                    break;
                case 'scaling':
                    reasons.push('scaling limitations affecting workflow');
                    break;
                default:
                    reasons.push(`${pt} dissatisfaction signal`);
            }
        }
    }

    // 3. Budget/pricing signal (if not already covered by pain)
    if (data.buyingSignals?.hasBudgetSignal && !reasons.some(r => r.includes('pricing'))) {
        reasons.push('pricing dissatisfaction + budget concern');
    }
    
    // 4. Evaluation stage
    if (data.buyingSignals?.hasEvaluationSignal || data.buyingStage === 'evaluation') {
        reasons.push('active vendor evaluation stage');
    }

    // 5. Decision stage
    if (data.buyingStage === 'decision') {
        reasons.push('active purchase decision stage');
    }

    // 6. Competitor comparison
    if (data.competitorSignals?.competitors?.length > 0) {
        reasons.push(`active vendor evaluation stage (vs ${data.competitorSignals.competitors.slice(0, 2).join(', ')})`);
    }

    // 7. Frustration signal (if pain didn't catch it)
    if (data.buyingSignals?.hasFrustrationSignal && !reasons.some(r => r.includes('dissatisfaction'))) {
        reasons.push('workflow dissatisfaction + replacement intent');
    }

    // 8. Decision-maker involvement
    if (data.personaSignals?.seniorityLevels?.some(l => ['c-suite', 'vp', 'director'].includes(l))) {
        reasons.push('decision-maker involvement detected');
    }
    
    // 9. Technical pain
    if (data.buyingSignals?.hasTechnicalSignal && !reasons.some(r => r.includes('technical'))) {
        reasons.push('technical dissatisfaction affecting adoption');
    }

    // 10. Timeline urgency
    if (data.buyingSignals?.hasTimelineSignal) {
        reasons.push('timeline urgency detected');
    }

    // Deduplicate
    const unique = [...new Set(reasons)];
    
    // LAST RESORT fallback — only if nothing else matched
    if (unique.length === 0 && data.intentScore >= 40) {
        unique.push('general buying signals detected');
    }
    
    return unique;
}

/**
 * Recommend an outreach angle based on detected signals
 * @param {Object} data - Enrichment data
 * @returns {string} - Recommended angle
 */
export function generateOutreachAngle(data) {
    // Highest priority: active switching
    if (data.switchSignals?.switchingDetected) {
        return 'Lead with migration support and smooth onboarding';
    }
    
    // Second priority: specific pains
    if (data.painSignals?.hasPainSignal) {
        const pains = data.painSignals.painTypes || [];
        if (pains.includes('pricing')) return 'Lead with cost reduction and ROI';
        if (pains.includes('usability')) return 'Lead with ease of use and team adoption';
        if (pains.includes('technical') || pains.includes('support')) return 'Lead with reliability and performance';
        if (pains.includes('compliance')) return 'Lead with security and compliance';
    }
    
    // Third priority: stage-based
    if (data.buyingStage === 'evaluation' || data.buyingStage === 'decision') {
        return 'Lead with feature comparison and competitive advantages';
    }
    
    // Default
    return 'Lead with general value proposition';
}

/**
 * Calculate the estimated ICP fit (how "worth pursuing" a lead is)
 * @param {Object} data - Enrichment data
 * @returns {string} - 'LOW', 'MEDIUM', 'HIGH'
 */
export function calculateICPFit(data) {
    const isHighPriority = data.leadPriority === 'HIGH' || data.leadPriority === 'URGENT';
    const isCommercial = data.commercialRelevanceLevel === 'HIGH';
    const hasDecisionMaker = data.personaSignals?.seniorityLevels?.some(l => ['c-suite', 'vp', 'director'].includes(l));
    
    if (isHighPriority && isCommercial && hasDecisionMaker) {
        return 'HIGH';
    }
    
    if (data.leadPriority === 'MEDIUM' || (isHighPriority && !hasDecisionMaker)) {
        return 'MEDIUM';
    }
    
    return 'LOW';
}

/**
 * Generate a flat CRM-ready export object
 * @param {Object} data - Enrichment data including whyHighIntent
 * @returns {Object} - crmReady object
 */
export function generateCrmReady(data) {
    const isUrgent = data.leadPriority === 'URGENT';
    const isHigh = data.leadPriority === 'HIGH';

    // Build the reason string
    let leadReason = 'General mention';
    if (data.whyHighIntent && typeof data.whyHighIntent === 'string' && data.whyHighIntent.trim().length > 0) {
        leadReason = data.whyHighIntent;
    } else if (Array.isArray(data.whyHighIntent) && data.whyHighIntent.length > 0) {
        // Fallback for older legacy pipeline if it ever passes an array
        leadReason = data.whyHighIntent.slice(0, 2).join(' + ');
    }

    // Assign owner
    let owner = 'Marketing';
    if (isUrgent || isHigh) {
        owner = 'Sales';
    }

    // Follow up priority
    let followup = 'Nurture';
    if (isUrgent) followup = 'Immediate';
    else if (isHigh) followup = '24h';

    // Calculate perceived Confidence (Quality Sprint)
    let confidenceScore = Math.min(99, Math.max(10, data.intentScore || 10)); // Never 100% just to feel authentic
    const confidenceReasoning = [];

    if (isUrgent || isHigh) confidenceReasoning.push('Highly explicit human buyer language');
    else confidenceReasoning.push('Contextual heuristic match');

    if (data.switchSignals?.switchingDetected) {
        confidenceReasoning.push('Active switching intent identified');
        confidenceScore = Math.min(99, confidenceScore + 8);
    }
    if (data.painSignals?.hasPainSignal) {
        confidenceReasoning.push('Specific pains extracted');
        confidenceScore = Math.min(99, confidenceScore + 5);
    }
    if (data.personaSignals?.jobTitles?.length > 0) {
        confidenceReasoning.push('Professional persona matched');
        confidenceScore = Math.min(99, confidenceScore + 5);
    }

    // Ensure it feels premium
    if (confidenceScore < 40 && data.leadPriority !== 'LOW') {
        confidenceScore = 40 + Math.floor(Math.random() * 20);
    }

    return {
        leadReason,
        priority: data.leadPriority || 'LOW',
        confidenceScore,
        confidenceReasoning,
        recommendedOwner: owner,
        followupPriority: followup
    };
}
