export function detectSwitchingSignals(text, validCompanies, knownCompetitors) {
    const match = text.match(/\b(switch(ing)?|migrate|migrating|move|moving|leave|leaving|alternative(s)? to)\b/i);
    let switchingDetected = !!match;
    let switchingFrom = null;
    let switchingTo = null;
    
    // Very basic entity detection for the cheap filter stage
    const lowerText = text.toLowerCase();
    for (const comp of [...validCompanies, ...knownCompetitors]) {
        if (lowerText.includes(comp.toLowerCase())) {
            if (switchingDetected && !switchingFrom) switchingFrom = comp;
        }
    }

    return {
        switchingDetected,
        switchingFrom,
        switchingTo,
        confidence: switchingDetected ? 0.6 : 0,
        stage: switchingDetected ? 'considering' : null
    };
}
