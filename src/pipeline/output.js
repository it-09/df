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
        if (!token || !datasetId) {
            log.warning(`Missing APIFY_TOKEN or APIFY_DEFAULT_DATASET_ID. Using local Actor.pushData fallback for ${typeLabel}.`);
            await Actor.pushData(items);
            return;
        }
        const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`;
        
        const dataArray = Array.isArray(items) ? items : [items];
        if (dataArray.length === 0) return;

        const CHUNK_SIZE = 5;
        const totalChunks = Math.ceil(dataArray.length / CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
            const chunk = dataArray.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            if (process.env.DEBUG_MODE === 'true') {
                console.log(`Persisting ${typeLabel} chunk ${i + 1}/${totalChunks}...`);
            }
            
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(chunk)
                });
                if (process.env.DEBUG_MODE === 'true') {
                    console.log(`POST status: ${response.status}`);
                    if (response.ok) {
                        console.log(`✅ chunk persisted`);
                    } else {
                        console.error(`❌ chunk failed`, await response.text());
                    }
                }
            } catch (e) {
                console.error(`❌ fetch error for chunk`, e);
            }
        }
    }

    const forensics = {
        FINAL_PUSH_COUNTS: {}
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
        signal.freshnessOverride = false;
        
        // Exception rules: explicit high-value commercial behavior
        const exceptionRegex = /(moving away from|switching from|looking for alternatives|fed up with|replacing|better than|migration|alternative|vs\b|versus\b|pricing|compare|comparison|problems|review)/i;
        if (exceptionRegex.test(signal.content || '') || exceptionRegex.test(signal.title || '')) {
            signal.freshnessOverride = true;
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
            if (!signal.freshnessOverride) {
                signal.intentScore = Math.max(0, signal.intentScore - 15);
                if (signal.signalQuality === 'HIGH') signal.signalQuality = 'MEDIUM';
            }
        } else if (ageDays <= 180) {
            signal.freshnessCategory = 'OLD';
            if (!signal.freshnessOverride) {
                signal.intentScore = Math.max(0, signal.intentScore - 30);
                signal.signalQuality = 'LOW';
            }
        } else {
            // Older than 180 days
            signal.freshnessCategory = 'ANCIENT';
            if (!signal.freshnessOverride) {
                signal.signalQuality = 'REJECT';
                signal.rejectionReason = `Content too old (${ageDays} days) without explicit commercial exception`;
            } else {
                signal.freshnessCategory = 'OLD (EXCEPTED)';
            }
        }

        // STRICT FILTERING: Drop noisy / rejected signals completely
        if (signal.signalQuality === 'REJECT') {
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
            continue;
        }
        if (signal.intentScore === undefined || !signal.source || !signal.company || !signal.url) {
            log.warning('INVALID_SIGNAL_REJECTED (Missing required schema fields)');
            continue;
        }

        buyingSignals.push(signal);
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

        // Charge per signal (PPE)
        try {
            await Actor.charge({ eventName: 'result-signal', count: 1 });
        } catch (error) {
            await Actor.setStatusMessage(`Billing limit reached (free plan?). Processed ${chargedSignals - 1} paid signals.`, { isStatusMessageTerminal: false });
            break;
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

    const isValid = finalRows.every(r => r.title && r.company && r.source);
    if (!isValid) {
        log.warning('ASSERTION FAILED: Invalid rows detected in final array. Skipping invalid rows.');
    } else if (finalRows.length > 0) {
        const payloadSizeKB = (Buffer.byteLength(JSON.stringify(finalRows), 'utf8') / 1024).toFixed(2);
        log.info(`Serialized payload size: ${payloadSizeKB} KB`);
        await pushDataToApify(finalRows, 'signals');
        log.info('Dataset persistence complete (Buying Signals).');
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
