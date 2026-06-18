// Pipeline Stage 5: Output, Post-Processing, Aggregation and Persistence
import { Actor, log } from 'apify';
import { generateSmartAlert } from '../classifiers/alerts.js';
import { aggregateByCompany, generateCompanyExecutiveSummary, generateExecutiveSummary, identifyHighIntentSignals, generateSalesInsights } from '../utils/aggregator.js';
import { calculateCompetitorRisk, saveMonitorState } from '../utils/monitor.js';

/**
 * Handle final processing, schema enforcement, aggregation, key-value storage, delta saving, and dataset persistence.
 */
export async function outputResults({
    enrichedSignals,
    monitoringMode,
    competitorWatch,
    previousStats,
    seenHashes,
    companyProfiles,
    validCompanies,
    token,
    datasetId
}) {
    async function pushDataToApify(items, typeLabel = 'data') {
        const dataArray = Array.isArray(items) ? items : [items];
        if (dataArray.length === 0) return;

        if (process.env.DEBUG_MODE === 'true') {
            console.log(`Persisting ${dataArray.length} items to default dataset...`);
        }

        try {
            await Actor.pushData(dataArray);
            if (process.env.DEBUG_MODE === 'true') {
                console.log(`✅ ${typeLabel} persisted to default dataset successfully.`);
            }
        } catch (e) {
            console.error(`❌ Actor.pushData error for ${typeLabel}`, e);
        }
    }

    const forensics = {
        FINAL_PUSH_COUNTS: {}
    };

    const diagnostics = {
        fetched: enrichedSignals.length,
        accepted: 0,
        rejected: {
            older_than_90_days: 0,
            developer_noise: 0,
            low_intent: 0,
            low_priority: 0,
            blacklisted: 0,
            missing_metadata: 0,
            invalid: 0
        },
        sources: {}
    };

    let chargedSignals = 0;
    const buyingSignals = [];
    const smartAlerts = [];
    
    for (const signal of enrichedSignals) {
        // --- Freshness Filtering ---
        const ageMs = Date.now() - new Date(signal.createdAt || new Date()).getTime();
        let ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        if (isNaN(ageDays) || ageDays < 0) ageDays = 0; // fallback for missing dates
        
        signal.contentAgeDays = ageDays;

        // HARD 90-DAY CUTOFF — No exceptions.
        if (ageDays > 90) {
            signal.signalQuality = 'REJECT';
            signal.rejectionReason = `Content too old (${ageDays} days). Buying signals must be ≤90 days.`;
        }

        // Track reason for rejection if already rejected upstream
        if (signal.signalQuality === 'REJECT') {
            if (signal.rejectionReason && signal.rejectionReason.toLowerCase().includes('noise')) {
                diagnostics.rejected.developer_noise++;
            } else if (signal.rejectionReason && signal.rejectionReason.toLowerCase().includes('old')) {
                diagnostics.rejected.older_than_90_days++;
            } else {
                diagnostics.rejected.low_intent++;
            }
            continue;
        }

        if (ageDays <= 7 && signal.dateSource === 'actual') {
            signal.freshnessCategory = 'HOT';
            signal.intentScore = Math.min(100, signal.intentScore + 10);
            signal.confidence = Math.min(1.0, (signal.confidence || 0.5) + 0.1);
            if (signal.signalQuality === 'MEDIUM') signal.signalQuality = 'HIGH';
        } else if (ageDays <= 7) {
            signal.freshnessCategory = 'RECENT'; // Inferred date — don't boost, just mark recent
        } else if (ageDays <= 30) {
            signal.freshnessCategory = 'RECENT';
        } else if (ageDays <= 90) {
            signal.freshnessCategory = 'STALE';
            signal.intentScore = Math.max(0, signal.intentScore - 15);
            if (signal.signalQuality === 'HIGH') signal.signalQuality = 'MEDIUM';
        }

        // STRICT FILTERING: Drop noisy / rejected signals completely
        if (signal.signalQuality === 'REJECT') {
            // Already tracked above
            continue;
        }

        // HIGH-INTENT FILTER: Only surface signals with genuine buyer intent.
        // Require leadPriority HIGH or URGENT — this already factors in intentScore,
        // so we don't need a separate score fallback (which was letting LOW-priority
        // signals slip through when intentScore was inflated).
        const isHighIntent = signal.leadPriority === 'URGENT' ||
            signal.leadPriority === 'HIGH';
        if (!isHighIntent) {
            diagnostics.rejected.low_priority++;
            continue;
        }

        // Truncate content for payload safety
        if (signal.content && signal.content.length > 1500) {
            signal.content = signal.content.substring(0, 1500) + '... [TRUNCATED]';
        }
        
        // Hard Assertions - Check missing fields or bad titles
        const badTitleCheck = /(artifact|hash|semantic|epic|rebranding|migration|internal)/i;
        if (!signal.title || signal.title.toLowerCase().includes('undefined') || badTitleCheck.test(signal.title)) {
            log.warning('INVALID_SIGNAL_REJECTED (Missing fields or bad title keywords)');
            diagnostics.rejected.invalid++;
            continue;
        }
        if (signal.intentScore === undefined || !signal.source || !signal.company || !signal.url) {
            log.warning('INVALID_SIGNAL_REJECTED (Missing required schema fields)');
            diagnostics.rejected.missing_metadata++;
            continue;
        }

        buyingSignals.push(signal);
        diagnostics.accepted++;
        diagnostics.sources[signal.source] = (diagnostics.sources[signal.source] || 0) + 1;
        forensics.FINAL_PUSH_COUNTS[signal.source] = (forensics.FINAL_PUSH_COUNTS[signal.source] || 0) + 1;
        chargedSignals++;

        // Smart Alerts
        if (monitoringMode !== 'off') {
            const alert = generateSmartAlert(signal);
            if (alert) {
                smartAlerts.push({
                    company: alert.company,
                    title: `SMART ALERT: ${alert.type}`,
                    source: "system",
                    url: "",
                    intentScore: 0,
                    leadPriority: "INFO",
                    signalQuality: "SYSTEM",
                    buyingStage: "monitoring",
                    whyHighIntent: alert.message,
                    recommendedOutreachAngle: ""
                });
            }
        }

    }
    
    // Schema Enforcement & Assertion
    const finalRows = buyingSignals.filter(signal =>
        signal &&
        signal.title &&
        signal.company &&
        signal.source &&
        signal.url &&
        typeof signal.intentScore === 'number'
    );

    if (finalRows.length !== buyingSignals.length) {
        log.warning(`INVALID_SIGNAL_REJECTED: Dropped ${buyingSignals.length - finalRows.length} invalid signals just before dataset push.`);
    }

    // Sort by recency: most recent signals first so users see the freshest intelligence at top.
    finalRows.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        // Secondary sort: higher intentScore wins when dates are equal or missing
        if (dateB !== dateA) return dateB - dateA;
        return (b.intentScore || 0) - (a.intentScore || 0);
    });

    const isValid = finalRows.every(r => r.title && r.company && r.source);
    if (!isValid) {
        log.warning('ASSERTION FAILED: Invalid rows detected in final array. Skipping invalid rows.');
    } else if (finalRows.length > 0) {
        log.info(`High-intent buying signals ready to push: ${finalRows.length} (filtered from ${enrichedSignals.length} total signals).`);
        const payloadSizeKB = (Buffer.byteLength(JSON.stringify(finalRows), 'utf8') / 1024).toFixed(2);
        log.info(`Serialized payload size: ${payloadSizeKB} KB`);
        await pushDataToApify(finalRows, 'signals');
        log.info('Dataset persistence complete (Buying Signals — HIGH/URGENT intent only, sorted most-recent-first).');

        // Charge per signal (PPE) after pushing data so the user retains what they pay for
        try {
            await Actor.charge({ eventName: 'result-signal', count: finalRows.length });
        } catch (error) {
            log.warning(`Billing limit reached during bulk charge. Successfully processed ${finalRows.length} signals.`);
        }
    } else {
        log.warning('No high-intent signals met the threshold (leadPriority HIGH/URGENT or intentScore >= 60). Dataset push skipped.');
    }
    
    // Save smart alerts to Key-Value Store instead of Dataset
    if (smartAlerts.length > 0) {
        await Actor.setValue('SMART_ALERTS', smartAlerts);
        log.info(`Saved ${smartAlerts.length} smart alerts to Key-Value Store.`);
    }

    // Generate aggregated insights
    log.info('Generating aggregated insights...');
    const aggregated = aggregateByCompany(enrichedSignals);
    const companySummary = generateCompanyExecutiveSummary(aggregated);
    const highIntentSignals = identifyHighIntentSignals(enrichedSignals);
    
    // Full Run Executive Summary / Weekly Digest
    const runSummary = generateExecutiveSummary(enrichedSignals, highIntentSignals, monitoringMode);

    // Competitor Watch
    let competitorRisk = {};
    if (monitoringMode !== 'off' && competitorWatch.length > 0) {
        competitorRisk = calculateCompetitorRisk(aggregated, previousStats, competitorWatch);
    }

    // Push aggregated data
    const aggregatedItems = [];
    aggregatedItems.push({
        ...runSummary,
        competitorRisk,
        companyRollup: companySummary
    });

    // Save State for next run
    if (monitoringMode !== 'off') {
        const statsToSave = {};
        for (const comp of aggregated) {
            statsToSave[comp.company] = comp;
        }
        await saveMonitorState(seenHashes, statsToSave);
    }

    // Save Premium Executive Summary to KVS
    await Actor.setValue('EXECUTIVE_SUMMARY', runSummary);
    await Actor.setValue('diagnostics', diagnostics);

    // Save Markdown version
    const mdSummary = `
# Executive Summary

**Top Risk:**
${runSummary.topRisk}

**Switching Signals:**
${runSummary.switchingSignals}

**Urgent Accounts:**
${runSummary.urgentAccounts}

**Top Pain Themes:**
${runSummary.topPainThemes.join(', ') || 'None'}

**Buying Stage Mix:**
Awareness: ${runSummary.buyingStageBreakdown.awareness}
Consideration: ${runSummary.buyingStageBreakdown.consideration}
Evaluation: ${runSummary.buyingStageBreakdown.evaluation}
Decision: ${runSummary.buyingStageBreakdown.decision}

**Recommended Outreach:**
${runSummary.recommendedOutreach}
`;
    await Actor.setValue('EXECUTIVE_SUMMARY_MD', mdSummary, { contentType: 'text/markdown' });

    // Print human-readable summary to logs
    log.info('');
    log.info('================================================');
    log.info('EXECUTIVE SUMMARY');
    log.info('================================================');
    log.info('');
    log.info('Top Risk:');
    log.info(runSummary.topRisk);
    log.info('');
    log.info('Switching Signals:');
    log.info(runSummary.switchingSignals);
    log.info('');
    log.info('Urgent Accounts:');
    log.info(runSummary.urgentAccounts);
    log.info('');
    log.info('Top Pain Themes:');
    log.info(runSummary.topPainThemes.join(', ') || 'None');
    log.info('');
    log.info('Buying Stage Mix:');
    log.info(`Awareness: ${runSummary.buyingStageBreakdown.awareness}`);
    log.info(`Evaluation: ${runSummary.buyingStageBreakdown.evaluation}`);
    log.info(`Decision: ${runSummary.buyingStageBreakdown.decision}`);
    log.info('');
    log.info('Recommended Outreach:');
    log.info(runSummary.recommendedOutreach);
    log.info('');
    log.info('================================================');
    log.info('');

    for (const companyInsight of aggregated) {
        aggregatedItems.push({
            _type: 'company_aggregate',
            ...companyInsight
        });
    }

    aggregatedItems.push({
        _type: 'high_intent_alerts',
        totalHighIntentSignals: highIntentSignals.length,
        signals: highIntentSignals.slice(0, 20) // Top 20
    });

    // Sales insights output
    const salesInsights = generateSalesInsights(enrichedSignals, aggregated);
    aggregatedItems.push({
        _type: 'sales_insights',
        ...salesInsights
    });
    
    const aggregatedPayloadSizeKB = (Buffer.byteLength(JSON.stringify(aggregatedItems), 'utf8') / 1024).toFixed(2);
    log.info(`Serialized payload size: ${aggregatedPayloadSizeKB} KB`);
    
    // Save aggregated insights to Key-Value store
    await Actor.setValue('AGGREGATED_INSIGHTS', aggregatedItems);
    log.info('Aggregated insights persistence complete (Key-Value Store).');

    log.info('Dark Funnel Intelligence Engine completed successfully', {
        totalSignals: enrichedSignals.length,
        companiesAnalyzed: aggregated.length,
        highIntentAlerts: highIntentSignals.length,
        chargedSignals,
    });

    // Forensics reporting
    if (process.env.DEBUG_MODE === 'true') {
        log.info('--- SOURCE FORENSICS ---');
        // Let's log whatever final push counts exist
        for (const src of Object.keys(forensics.FINAL_PUSH_COUNTS)) {
            const fin = forensics.FINAL_PUSH_COUNTS[src] || 0;
            log.info(`${src}: final push count: ${fin}`);
        }
    }

    const finalBuyingSignalCount = Object.values(forensics.FINAL_PUSH_COUNTS).reduce((a, b) => a + b, 0);
    
    // Source Diversity Assertion
    for (const [src, count] of Object.entries(forensics.FINAL_PUSH_COUNTS)) {
        if (finalBuyingSignalCount > 0 && (count / finalBuyingSignalCount) > 0.80) {
            log.warning(`SOURCE_IMBALANCE_WARNING: Dataset is heavily skewed toward ${src} (${Math.round((count / finalBuyingSignalCount) * 100)}%).`);
        }
    }

    const hasReddit = (forensics.FINAL_PUSH_COUNTS['reddit'] || 0) > 0;
    const hasLinkedin = (forensics.FINAL_PUSH_COUNTS['linkedin'] || 0) > 0;
    const hasG2 = (forensics.FINAL_PUSH_COUNTS['g2'] || 0) > 0;
    
    if (!hasReddit && !hasLinkedin && !hasG2) {
        log.warning('LOW_CONFIDENCE: Missing essential non-developer sources (Reddit, LinkedIn, or G2). Run returned low commercial intelligence.');
    }

    return { finalBuyingSignalCount, highIntentAlertsCount: highIntentSignals.length };
}
