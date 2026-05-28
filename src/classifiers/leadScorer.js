export function calculateIntentScore(signals, sourceName = 'unknown', subreddit = '') {
    let score = 10; // base

    if (signals.buyingSignals?.hasEvaluationSignal) score += 20;
    if (signals.buyingSignals?.hasDecisionSignal) score += 30;
    
    if (signals.painSignals?.hasPainSignal) score += (signals.painSignals.severity * 20);
    
    if (signals.switchSignals?.switchingDetected) score += 30;
    
    if (signals.personaSignals?.isDecisionMaker) score += 20;
    else if (signals.personaSignals?.jobTitles?.length > 0) score += 10;

    // Apply Deep Source & Subreddit Weighting (Wave 4A)
    const sourceLower = sourceName.toLowerCase();
    const subLower = (subreddit || '').toLowerCase();
    
    let multiplier = 1.0;
    
    if (sourceLower.includes('g2')) {
        multiplier = 1.5; // High inherent evaluation intent
    } else if (sourceLower.includes('reddit')) {
        const highValueB2B = ['revops', 'salesops', 'b2b', 'ecommerce', 'marketingautomation', 'agency', 'growthhacking', 'entrepreneurridealong', 'smallbusiness', 'saas'];
        const lowValueTech = ['technology', 'webdev', 'programming', 'developer', 'reactjs', 'javascript'];
        
        if (highValueB2B.some(sub => subLower.includes(sub))) {
            multiplier = 1.5;
        } else if (lowValueTech.some(sub => subLower.includes(sub))) {
            multiplier = 0.7; // Penalize technical chatter
        } else {
            multiplier = 1.2; // Standard Reddit baseline
        }
    } else if (sourceLower.includes('github')) {
        multiplier = 0.8;
    }
    
    score = Math.round(score * multiplier);

    return {
        intentScore: Math.min(100, score),
        intentLevel: score >= 60 ? 'HIGH' : (score >= 30 ? 'MEDIUM' : 'LOW')
    };
}

export function calculateLeadPriority(signals) {
    if (signals.commercialRelevanceLevel === 'LOW') return 'LOW';
    if (signals.intentScore >= 80) return 'URGENT';
    if (signals.intentScore >= 60) return 'HIGH';
    if (signals.intentScore >= 30) return 'MEDIUM';
    return 'LOW';
}
