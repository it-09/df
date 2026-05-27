// Insights aggregation utilities

/**
 * Aggregate signals by company
 * @param {Array} signals - All signals
 * @returns {Array} - Aggregated company insights
 */
export function aggregateByCompany(signals) {
    const companyMap = new Map();

    for (const signal of signals) {
        const company = signal.company;

        if (!companyMap.has(company)) {
            companyMap.set(company, {
                company,
                totalSignals: 0,
                sources: new Set(),
                sentimentScores: [],
                buyingSignals: [],
                personas: new Set(),
                competitors: new Set(),
                firstSeen: signal.createdAt,
                lastSeen: signal.createdAt,
                signals: []
            });
        }

        const companyData = companyMap.get(company);
        companyData.totalSignals++;
        companyData.sources.add(signal.source);
        companyData.signals.push(signal);

        if (signal.sentiment) {
            companyData.sentimentScores.push(signal.sentiment.score);
        }

        if (signal.buyingSignals && signal.buyingSignals.signals.length > 0) {
            companyData.buyingSignals.push(...signal.buyingSignals.signals);
        }

        if (signal.personaSignals && signal.personaSignals.jobTitles) {
            signal.personaSignals.jobTitles.forEach(title => companyData.personas.add(title));
        }

        if (signal.competitorSignals && signal.competitorSignals.competitors) {
            signal.competitorSignals.competitors.forEach(comp => companyData.competitors.add(comp));
        }

        // Update time range
        if (new Date(signal.createdAt) < new Date(companyData.firstSeen)) {
            companyData.firstSeen = signal.createdAt;
        }
        if (new Date(signal.createdAt) > new Date(companyData.lastSeen)) {
            companyData.lastSeen = signal.createdAt;
        }
    }

    // Convert to array and calculate aggregated metrics
    const aggregated = Array.from(companyMap.values()).map(data => {
        const avgSentiment = data.sentimentScores.length > 0
            ? data.sentimentScores.reduce((a, b) => a + b, 0) / data.sentimentScores.length
            : 0;

        const sentimentLabel = avgSentiment > 1 ? 'positive'
            : avgSentiment < -1 ? 'negative'
                : 'neutral';

        // Get top buying signals
        const signalCounts = {};
        data.buyingSignals.forEach(sig => {
            signalCounts[sig] = (signalCounts[sig] || 0) + 1;
        });

        const topBuyingSignals = Object.entries(signalCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([signal]) => signal);

        return {
            company: data.company,
            totalSignals: data.totalSignals,
            sources: Array.from(data.sources),
            avgSentiment,
            sentimentLabel,
            topBuyingSignals,
            personas: Array.from(data.personas),
            competitors: Array.from(data.competitors),
            firstSeen: data.firstSeen,
            lastSeen: data.lastSeen,
            signalVelocity: calculateVelocity(data.firstSeen, data.lastSeen, data.totalSignals)
        };
    });

    // Sort by total signals descending
    return aggregated.sort((a, b) => b.totalSignals - a.totalSignals);
}

/**
 * Calculate signal velocity (signals per day)
 */
function calculateVelocity(firstSeen, lastSeen, totalSignals) {
    const start = new Date(firstSeen);
    const end = new Date(lastSeen);
    const days = Math.max(1, (end - start) / (1000 * 60 * 60 * 24));
    return (totalSignals / days).toFixed(2);
}

/**
 * Generate executive summary
 * @param {Array} aggregated - Aggregated company data
 * @returns {Object} - Executive summary
 */
export function generateExecutiveSummary(aggregated) {
    const totalCompanies = aggregated.length;
    const totalSignals = aggregated.reduce((sum, c) => sum + c.totalSignals, 0);

    const positiveCompanies = aggregated.filter(c => c.sentimentLabel === 'positive').length;
    const negativeCompanies = aggregated.filter(c => c.sentimentLabel === 'negative').length;

    const topCompanies = aggregated.slice(0, 5).map(c => ({
        company: c.company,
        signals: c.totalSignals,
        sentiment: c.sentimentLabel
    }));

    // Find high-priority alerts (negative sentiment + competitive signals)
    const alerts = aggregated
        .filter(c => c.sentimentLabel === 'negative' && c.competitors.length > 0)
        .map(c => ({
            company: c.company,
            reason: `Negative sentiment detected with ${c.competitors.length} competitor mentions`,
            competitors: c.competitors
        }));

    return {
        totalCompanies,
        totalSignals,
        avgSignalsPerCompany: (totalSignals / Math.max(1, totalCompanies)).toFixed(1),
        sentimentBreakdown: {
            positive: positiveCompanies,
            negative: negativeCompanies,
            neutral: totalCompanies - positiveCompanies - negativeCompanies
        },
        topCompanies,
        highPriorityAlerts: alerts,
        generatedAt: new Date().toISOString()
    };
}

/**
 * Identify high-intent signals
 * @param {Array} signals - All signals
 * @returns {Array} - High-intent signals
 */
export function identifyHighIntentSignals(signals) {
    return signals
        .filter(signal => {
            // High intent criteria:
            // - High buying signal confidence (>0.6)
            // - Strong sentiment (positive or negative)
            // - Decision-maker persona

            const highBuyingSignal = signal.buyingSignals && signal.buyingSignals.confidence > 0.6;
            const strongSentiment = signal.sentiment && Math.abs(signal.sentiment.score) > 3;
            const hasDecisionMaker = signal.personaSignals &&
                signal.personaSignals.seniorityLevels &&
                signal.personaSignals.seniorityLevels.some(level =>
                    ['c-suite', 'vp', 'director'].includes(level)
                );

            return highBuyingSignal || strongSentiment || hasDecisionMaker;
        })
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}