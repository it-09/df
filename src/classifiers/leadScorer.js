export function calculateIntentScore(signals, sourceName = 'unknown', subreddit = '', daysOld = 0, isNoise = false) {
    let score = 10; // base

    if (signals.buyingSignals?.hasBudgetSignal) score += 20;
    if (signals.buyingSignals?.hasEvaluationSignal) score += 20;
    if (signals.buyingSignals?.hasDecisionSignal) score += 30;
    if (signals.buyingSignals?.hasFrustrationSignal) score += 30;
    if (signals.buyingSignals?.hasTimelineSignal) score += 15;
    if (signals.buyingSignals?.hasTechnicalSignal) score += 10;
    
    if (signals.painSignals?.hasPainSignal) {
        const painBoost = Math.min(30, Math.round(signals.painSignals.severity * 40));
        score += painBoost;
    }
    
    if (signals.switchSignals?.switchingDetected) score += 35;
    if (signals.competitorSignals?.hasCompetitiveSignal) score += 20;
    
    if (signals.personaSignals?.isDecisionMaker) score += 20;
    else if (signals.personaSignals?.jobTitles?.length > 0) score += 10;

    // Source & subreddit weighting
    const sourceLower = sourceName.toLowerCase();
    const subLower = (subreddit || '').toLowerCase();
    
    let multiplier = 1.0;
    
    if (sourceLower.includes('g2')) {
        multiplier = 1.6; // G2 reviews = pure buyer voice, highest intent
    } else if (sourceLower.includes('reddit')) {
        const highValueB2B = ['revops', 'salesops', 'b2b', 'ecommerce', 'marketingautomation', 'agency', 'growthhacking', 'entrepreneurridealong', 'smallbusiness', 'saas', 'crm', 'startups', 'entrepreneur'];
        const lowValueTech = ['technology', 'webdev', 'programming', 'developer', 'reactjs', 'javascript'];
        
        if (highValueB2B.some(sub => subLower.includes(sub))) {
            multiplier = 1.5;
        } else if (lowValueTech.some(sub => subLower.includes(sub))) {
            multiplier = 0.7;
        } else {
            multiplier = 1.2;
        }
    } else if (sourceLower.includes('linkedin')) {
        multiplier = 1.1; // LinkedIn is professional context
    } else if (sourceLower.includes('github')) {
        multiplier = 1.0; // GitHub issues are real buyer pain now that filters are stricter
    }
    
    score = Math.round(score * multiplier);

    // Noise penalty
    if (isNoise) score -= 50;

    // Age penalties — softer when signal has explicit pain or switching intent
    const isHighValueSignal = signals.switchSignals?.switchingDetected || 
                               signals.painSignals?.severity > 0.3 ||
                               signals.buyingSignals?.hasFrustrationSignal;

    if (daysOld > 90) {
        score -= isHighValueSignal ? 10 : 25; // Softer penalty for high-value old signals
    } else if (daysOld > 30) {
        score -= 5;
    } else if (daysOld <= 7) {
        score += 15; // Freshness boost
    }

    score = Math.max(0, score);
    
    // Floor: frustration + competitor signals are always medium+
    if (signals.buyingSignals?.hasFrustrationSignal && signals.competitorSignals?.hasCompetitiveSignal) {
        score = Math.max(score, 60);
    }
    // Floor: explicit switching detected = at least medium
    if (signals.switchSignals?.switchingDetected) {
        score = Math.max(score, 55);
    }

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
