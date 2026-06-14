// Explicit switching / migration intent verbs
const EXPLICIT_SWITCH_PATTERNS = /\b(switch(ing)?|migrate|migrating|move away|moving away|leave|leaving|abandon|abandoning|drop(ping)?|ditch(ing)?|dump(ing)?|replacing|replace|cancel(l?ing)?|unsubscrib(e|ing)|churn(ing)?|exit(ing)?)\b/i;

// Implicit switching intent — frustration + tool name = switching signal
const IMPLICIT_SWITCH_PATTERNS = /\b(tired of|sick of|done with|had enough of|fed up with|no longer using|moving on from|looking to leave|want to leave|thinking of leaving|considering leaving|left .{0,30} for|switched from|switched to|transitioned from|now using instead)\b/i;

// Phrases that signal the user is actively searching for an alternative
const SEEKING_ALTERNATIVE_PATTERNS = /\b(alternative(s)? to|replacement for|what replaces|what can replace|looking for .{0,20} alternative|something better than|better option than|instead of)\b/i;

export function detectSwitchingSignals(text, validCompanies = [], knownCompetitors = []) {
    const lowerText = text.toLowerCase();

    const hasExplicitSwitch = EXPLICIT_SWITCH_PATTERNS.test(lowerText);
    const hasImplicitSwitch = IMPLICIT_SWITCH_PATTERNS.test(lowerText);
    const hasSeekingAlternative = SEEKING_ALTERNATIVE_PATTERNS.test(lowerText);

    const switchingDetected = hasExplicitSwitch || hasImplicitSwitch || hasSeekingAlternative;

    let switchingFrom = null;
    let switchingTo = null;
    let stage = null;

    if (switchingDetected) {
        // Detect which company is being switched FROM
        for (const comp of [...validCompanies, ...knownCompetitors]) {
            const compLower = comp.toLowerCase();
            if (lowerText.includes(compLower)) {
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
        if (hasExplicitSwitch && switchingFrom) {
            stage = hasSeekingAlternative ? 'evaluating' : 'decided';
        } else if (hasImplicitSwitch) {
            stage = 'considering';
        } else {
            stage = 'researching';
        }
    }

    // Confidence based on signal strength
    let confidence = 0;
    if (hasExplicitSwitch) confidence += 0.4;
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
