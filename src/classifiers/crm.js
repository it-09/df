// CRM Intelligence Classifier
// Generates sales-ready fields for lead prioritization and outreach

/**
 * Generate a human-readable list explaining why a lead is high intent
 * @param {Object} data - Enrichment data
 * @returns {string[]} - Array of reasons
 */
export function generateExplainability(data) {
    const reasons = [];
    
    if (data.switchSignals?.switchingDetected) {
        if (data.switchSignals.switchingFrom) {
            reasons.push(`switching from ${data.switchSignals.switchingFrom}`);
        } else {
            reasons.push('switching intent detected');
        }
    }
    
    if (data.painSignals?.hasPainSignal) {
        data.painSignals.painTypes.forEach(pt => {
            reasons.push(`${pt} dissatisfaction`);
        });
    }
    
    if (data.personaSignals?.seniorityLevels?.some(l => ['c-suite', 'vp', 'director'].includes(l))) {
        reasons.push('decision-maker involved');
    }
    
    if (data.buyingStage === 'evaluation') {
        reasons.push('active evaluation stage');
    }
    
    if (data.buyingSignals?.hasBudgetSignal) {
        reasons.push('budget/pricing mentioned');
    }
    
    if (data.competitorSignals?.competitors?.length > 0) {
        reasons.push('competitor comparison');
    }
    
    // Fallback if empty but intent is high
    if (reasons.length === 0 && data.intentScore >= 40) {
        reasons.push('general buying signals detected');
    }
    
    return reasons;
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
