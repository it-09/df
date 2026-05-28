export function calculateCommercialRelevance(text, title, author, signals) {
    const lowerText = (text || '').toLowerCase();
    
    // Auto-reject known garbage
    if (lowerText.includes('bot') || lowerText.includes('changelog') || lowerText.includes('release notes') || lowerText.includes('ci/cd')) {
        return { commercialRelevanceScore: 0, commercialRelevanceLevel: 'LOW' };
    }

    let score = 50; // base score
    
    if (signals.buyingSignals?.hasEvaluationSignal || signals.switchSignals?.switchingDetected) score += 30;
    if (signals.painSignals?.hasPainSignal) score += 20;

    return {
        commercialRelevanceScore: Math.min(100, score),
        commercialRelevanceLevel: score >= 70 ? 'HIGH' : (score >= 40 ? 'MEDIUM' : 'LOW')
    };
}
