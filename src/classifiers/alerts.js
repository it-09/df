// Smart Alerts Classifier
// Decides when to emit a distinct alert to prevent alert fatigue

/**
 * Generate smart alerts based on signal deltas
 * @param {Object} signal - Enriched signal
 * @returns {Object|null} - Alert object or null
 */
export function generateSmartAlert(signal) {
    // Rule 1: We only alert on NET-NEW signals
    if (!signal.isNew) {
        return null;
    }

    // Rule 2: Alert on URGENT or HIGH intent leads
    if (signal.leadPriority === 'URGENT' || signal.leadPriority === 'HIGH') {
        const reason = signal.crmReady?.leadReason || 'High intent detected';
        return {
            _type: 'smart_alert',
            severity: signal.leadPriority,
            company: signal.company,
            reason: `New lead: ${reason}`,
            recommendedAction: signal.recommendedOutreachAngle || 'Immediate review required',
            url: signal.url,
            createdAt: new Date().toISOString()
        };
    }

    // Rule 3: Alert on explicit competitor switching (even if MEDIUM priority)
    if (signal.switchSignals?.switchingDetected && signal.leadPriority === 'MEDIUM') {
        return {
            _type: 'smart_alert',
            severity: 'MEDIUM',
            company: signal.company,
            reason: `New competitor switching discussion detected`,
            recommendedAction: 'Monitor and intercept if stage advances',
            url: signal.url,
            createdAt: new Date().toISOString()
        };
    }

    return null;
}
