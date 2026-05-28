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
                painTypes: new Set(),
                switchingSignals: 0,
                intentScores: [],
                highestPriority: 'LOW',
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

        // NEW: Track pain types
        if (signal.painSignals && signal.painSignals.painTypes) {
            signal.painSignals.painTypes.forEach(pt => companyData.painTypes.add(pt));
        }

        // NEW: Track switching intent
        if (signal.switchSignals && signal.switchSignals.switchingDetected) {
            companyData.switchingSignals++;
        }

        // NEW: Track intent scores
        if (signal.intentScore !== undefined) {
            companyData.intentScores.push(signal.intentScore);
        }

        // NEW: Track highest priority
        if (signal.leadPriority) {
            const priorities = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'URGENT': 4 };
            const currentPrio = priorities[companyData.highestPriority] || 1;
            const sigPrio = priorities[signal.leadPriority] || 1;
            if (sigPrio > currentPrio) {
                companyData.highestPriority = signal.leadPriority;
            }
        }

        // Update time range (guard against null dates)
        if (signal.createdAt) {
            const signalDate = new Date(signal.createdAt);
            if (!isNaN(signalDate.getTime())) {
                if (!companyData.firstSeen || signalDate < new Date(companyData.firstSeen)) {
                    companyData.firstSeen = signal.createdAt;
                }
                if (!companyData.lastSeen || signalDate > new Date(companyData.lastSeen)) {
                    companyData.lastSeen = signal.createdAt;
                }
            }
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
            painTypes: Array.from(data.painTypes),
            switchingSignals: data.switchingSignals,
            avgIntentScore: data.intentScores.length > 0
                ? Math.round(data.intentScores.reduce((a, b) => a + b, 0) / data.intentScores.length)
                : 0,
            highestPriority: data.highestPriority,
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
 * Generate an executive summary or weekly digest of the entire run
 * @param {Array} allSignals - Array of all enriched signals
 * @param {Array} highIntentAlerts - Array of high intent alerts
 * @param {string} mode - 'off', 'daily', 'weekly'
 * @returns {Object} - Digest object
 */
export function generateExecutiveSummary(allSignals, highIntentAlerts, mode = 'off') {
    const commercialSignals = allSignals.filter(s => s.commercialRelevanceLevel !== 'LOW');
    const newHighIntent = highIntentAlerts.filter(s => s.isNew);
    
    // Calculate top pain theme
    const painThemes = {};
    commercialSignals.forEach(s => {
        if (s.painSignals?.hasPainSignal) {
            s.painSignals.painTypes.forEach(p => {
                painThemes[p] = (painThemes[p] || 0) + 1;
            });
        }
    });
    const topPainTheme = Object.keys(painThemes).sort((a, b) => painThemes[b] - painThemes[a])[0] || 'None detected';
    
    // Calculate top competitor risk
    const competitorMentions = {};
    commercialSignals.forEach(s => {
        if (s.competitorSignals?.competitors) {
            s.competitorSignals.competitors.forEach(c => {
                competitorMentions[c] = (competitorMentions[c] || 0) + 1;
            });
        }
    });
    const topCompetitorRisk = Object.keys(competitorMentions).sort((a, b) => competitorMentions[b] - competitorMentions[a])[0] || 'None detected';
    
    // Calculate strongest source
    const sourceCounts = {};
    commercialSignals.forEach(s => {
        sourceCounts[s.source] = (sourceCounts[s.source] || 0) + 1;
    });
    const strongestSignalSource = Object.keys(sourceCounts).sort((a, b) => sourceCounts[b] - sourceCounts[a])[0] || 'None';

    // Calculate top outreach angle
    const angles = {};
    commercialSignals.forEach(s => {
        if (s.recommendedOutreachAngle) {
            angles[s.recommendedOutreachAngle] = (angles[s.recommendedOutreachAngle] || 0) + 1;
        }
    });
    const topOutreachAngle = Object.keys(angles).sort((a, b) => angles[b] - angles[a])[0] || 'Standard';

    // Fast growing intent (simplified heuristic for digest)
    const fastestGrowingIntentSignal = Object.keys(painThemes)[0] || 'alternative discussions';

    if (mode === 'weekly' || mode === 'daily') {
        return {
            _type: 'weekly_digest',
            highIntentLeads: highIntentAlerts.length,
            newLeads: newHighIntent.length,
            topPainTheme,
            topCompetitorRisk,
            topOutreachAngle,
            fastestGrowingIntentSignal
        };
    }

    return {
        _type: 'executive_summary',
        totalCommercialSignals: commercialSignals.length,
        highIntentLeads: highIntentAlerts.length,
        topPainTheme,
        topCompetitorRisk,
        strongestSignalSource,
        topOutreachAngle
    };
}

/**
 * Generate company-level executive summary
 * @param {Array} aggregated - Aggregated company data
 * @returns {Object} - Executive summary
 */
export function generateCompanyExecutiveSummary(aggregated) {
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
        .filter(signal => signal.leadPriority === 'URGENT' || signal.leadPriority === 'HIGH')
        .sort((a, b) => (b.intentScore || 0) - (a.intentScore || 0));
}

/**
 * Generate sales insights based on prioritized leads
 * @param {Array} signals - All enriched signals
 * @param {Array} aggregated - Aggregated company data
 * @returns {Object} - Sales insights summary
 */
export function generateSalesInsights(signals, aggregated) {
    // Filter for HIGH and URGENT signals
    const topSignals = signals.filter(s =>
        s.leadPriority === 'URGENT' || s.leadPriority === 'HIGH'
    );

    const opportunityMap = new Map();

    for (const signal of topSignals) {
        const company = signal.company;
        if (!opportunityMap.has(company)) {
            opportunityMap.set(company, {
                company,
                reasons: new Set(),
                priority: 'HIGH',
                maxIntentScore: 0,
                painTypes: new Set(),
                switchingFrom: new Set()
            });
        }

        const opp = opportunityMap.get(company);

        // Track highest priority and intent
        if (signal.leadPriority === 'URGENT') opp.priority = 'URGENT';
        if (signal.intentScore > opp.maxIntentScore) opp.maxIntentScore = signal.intentScore;

        // Build reasons
        if (signal.painSignals?.hasPainSignal) {
            signal.painSignals.painTypes.forEach(pt => {
                opp.painTypes.add(pt);
                opp.reasons.add(`${pt} pain`);
            });
        }

        if (signal.switchSignals?.switchingDetected) {
            if (signal.switchSignals.switchingFrom) {
                opp.switchingFrom.add(signal.switchSignals.switchingFrom);
                opp.reasons.add(`switching from ${signal.switchSignals.switchingFrom}`);
            } else {
                opp.reasons.add('switching intent detected');
            }
        }

        if (signal.buyingStage === 'evaluation' || signal.buyingStage === 'decision') {
            opp.reasons.add('active evaluation');
        }

        if (signal.personaSignals?.isDecisionMaker) {
            opp.reasons.add('decision-maker involved');
        }
    }

    // Format top opportunities
    const topOpportunities = Array.from(opportunityMap.values())
        .map(opp => {
            const painArray = Array.from(opp.painTypes);
            let recommendedAngle = 'general outreach';

            // Very simple recommendation mapping based on pain
            if (painArray.includes('pricing')) recommendedAngle = 'cost reduction';
            else if (painArray.includes('technical') || painArray.includes('support')) recommendedAngle = 'reliability and support';
            else if (painArray.includes('scaling')) recommendedAngle = 'enterprise readiness';
            else if (painArray.includes('compliance')) recommendedAngle = 'security and compliance';
            else if (painArray.includes('usability')) recommendedAngle = 'ease of use';

            return {
                company: opp.company,
                reason: Array.from(opp.reasons).slice(0, 3).join(' + '),
                priority: opp.priority,
                intentScore: opp.maxIntentScore,
                painTypes: painArray,
                switchingFrom: Array.from(opp.switchingFrom)[0] || null,
                recommendedAngle
            };
        })
        .sort((a, b) => b.intentScore - a.intentScore)
        .slice(0, 10); // Top 10

    return {
        generatedAt: new Date().toISOString(),
        totalOpportunities: topOpportunities.length,
        topOpportunities
    };
}