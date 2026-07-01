import { matchesCompany } from '../utils/normalizer.js';

// Explicit switching / migration intent verbs (unambiguous — no standalone replace/cancel/drop/leave)
const EXPLICIT_SWITCH_PATTERNS = /\b(switch(ing|ed)?|migrate|migrating|migrated|move away|moving away|abandon|abandoning|ditch(ing|ed)?|dump(ing|ed)?|unsubscrib(e|ed|ing)|churn(ed|ing)?|exit(ing|ed)?)\b/i;

// Context-aware patterns for words that need tool/company context to be unambiguous
// e.g., "replace my subscription" = switching, but "replace my data" = NOT switching
// Allow optional intervening words between possessive and noun (e.g., "replacing our current tool")
const CONTEXTUAL_REPLACE = /\b(replace|replacing)\s+(?:this|my|our|the|your)\s+(?:\w+\s+){0,3}(tool|platform|software|subscription|service|plan|product|solution|stack|provider|vendor)\b/i;
const CONTEXTUAL_CANCEL = /\b(cancel(l?ed|l?ing)?)\s+(?:this|my|our|the|your)\s+(?:\w+\s+){0,3}(subscription|account|plan|membership|contract|service)\b/i;
const CONTEXTUAL_LEAVE = /\b(leave|leaving)\s+(?:this|my|our|the|your)\s+(?:\w+\s+){0,3}(tool|platform|service|subscription|company|vendor)\b/i;
const CONTEXTUAL_DROP = /\b(drop(ped|ping)?)\s+(?:this|my|our|the|your)\s+(?:\w+\s+){0,3}(tool|platform|software|subscription|service|plan|vendor)\b/i;

// Implicit switching intent — frustration + tool name = switching signal
const IMPLICIT_SWITCH_PATTERNS = /\b(tired of|sick of|done with|had enough of|fed up with|no longer using|moving on from|looking to leave|want to leave|thinking of leaving|considering leaving|left .{0,30} for|switched from|switched to|transitioned from|now using instead)\b/i;

// Phrases that signal the user is actively searching for an alternative
const SEEKING_ALTERNATIVE_PATTERNS = /\b(alternative(s)? to|replacement for|what replaces|what can replace|looking for .{0,20} alternative|something better than|better option than|instead of)\b/i;

// Negative context: complaint/support-request keywords that indicate frustration
// without switching intent. If these appear alongside a contextual match,
// it's likely a complaint, not a switching signal.
const COMPLAINT_CONTEXT = /\b(data loss|lost my|lost all|support ticket|restore|recover|bug|buggy|broken|crash|error|glitch|down|outage|downtime|corrupted|missing data|deleted|wiped)\b/i;

// Retrospective context: statements about past regret, not active switching intent.
// e.g., "I should have switched", "I didn't switch", "wish I had switched"
// These are frustration/regret, not actual switching plans.
const RETROSPECTIVE_CONTEXT = /\b(didn'?t\s+switch|should\s+have\s+switched|wish\s+(I|we)\s+had\s+switched|would\s+have\s+switched|could\s+have\s+switched|should\s+have\s+moved|should\s+have\s+left|didn'?t\s+migrate|before\s+this\s+happened|before\s+it\s+happened|too\s+late|didn'?t\s+leave|never\s+switched|regret\s+not)\b/i;

// UI/setting context: "switch" used as a verb for toggling, not tool migration.
// e.g., "toggle to switch it off", "switch off", "switch on", "switch-off"
const UI_CONTEXT = /\b(switch\s+(it|this|that|the|them|everything|all)\s+(off|on|out)|toggle\s+to\s+switch|switch\s+off|switch\s+on|switch[- ]off)\b/i;

export function detectSwitchingSignals(text, validCompanies = [], knownCompetitors = [], originalText = '') {
    const lowerText = text.toLowerCase();

    const hasExplicitSwitch = EXPLICIT_SWITCH_PATTERNS.test(lowerText);
    const hasImplicitSwitch = IMPLICIT_SWITCH_PATTERNS.test(lowerText);
    const hasSeekingAlternative = SEEKING_ALTERNATIVE_PATTERNS.test(lowerText);

    // Context-aware matches: these words alone are too ambiguous
    const hasContextualSwitch =
        CONTEXTUAL_REPLACE.test(lowerText) ||
        CONTEXTUAL_CANCEL.test(lowerText) ||
        CONTEXTUAL_LEAVE.test(lowerText) ||
        CONTEXTUAL_DROP.test(lowerText);

    // Negative context guard: if a contextual pattern matches but the text is
    // primarily a complaint/support request, suppress the switching signal.
    const hasComplaintContext = COMPLAINT_CONTEXT.test(lowerText);
    const hasRetrospectiveContext = RETROSPECTIVE_CONTEXT.test(lowerText);
    const hasUiContext = UI_CONTEXT.test(lowerText);
    const contextualSuppressed = hasContextualSwitch && hasComplaintContext;

    // Retrospective suppression: "I should have switched" is regret, not intent.
    // UI suppression: "toggle to switch it off" is about a setting, not migration.
    const explicitSuppressed = hasExplicitSwitch && (hasRetrospectiveContext || hasUiContext);

    const switchingDetected = (hasExplicitSwitch && !explicitSuppressed) || hasImplicitSwitch || hasSeekingAlternative || (hasContextualSwitch && !hasComplaintContext);

    let switchingFrom = null;
    let switchingTo = null;
    let stage = null;

    if (switchingDetected) {
        // Detect which company is being switched FROM
        for (const comp of [...validCompanies, ...knownCompetitors]) {
            const compLower = comp.toLowerCase();
            if (matchesCompany(lowerText, compLower, originalText)) {
                // Heuristic: if switching language appears near company name, it's the "from"
                if (!switchingFrom) switchingFrom = comp;
            }
        }

        // Detect which company is being switched TO
        // Look for patterns like "switching to X", "moved to X", "now using X"
        const switchToMatch = lowerText.match(/\b(?:switch(?:ed|ing)?\s+to|mov(?:ed|ing)\s+to|now\s+using|migrat(?:ed|ing)\s+to|went\s+with|chose|selected|went\s+to)\s+([a-z0-9\s]{2,25}?)(?:\s+(?:and|for|because|as|it|from|to|but|so|since)|[.,!?\n]|$)/i);
        if (switchToMatch) {
            const candidate = switchToMatch[1]?.trim();
            if (candidate && candidate.length > 1 && candidate !== switchingFrom?.toLowerCase()) {
                switchingTo = candidate.charAt(0).toUpperCase() + candidate.slice(1);
            }
        }

        // Determine stage
        if ((hasExplicitSwitch || hasContextualSwitch) && switchingFrom && !explicitSuppressed) {
            stage = hasSeekingAlternative ? 'evaluating' : 'decided';
        } else if (hasImplicitSwitch) {
            stage = 'considering';
        } else {
            stage = 'researching';
        }
    }

    // Confidence based on signal strength
    let confidence = 0;
    if (hasExplicitSwitch && !explicitSuppressed) confidence += 0.4;
    if (hasContextualSwitch && !hasComplaintContext) confidence += 0.35;
    if (hasImplicitSwitch) confidence += 0.3;
    if (hasSeekingAlternative) confidence += 0.2;
    if (switchingFrom) confidence += 0.1;
    if (switchingTo) confidence += 0.1;

    return {
        switchingDetected,
        switchingFrom,
        switchingTo,
        confidence: Math.min(1.0, confidence),
        stage
    };
}
