const PAIN_PATTERNS = {
    pricing: /\b(too expensive|cost|pricing|price|budget|roi|cheaper)\b/i,
    scaling: /\b(scale|scaling|slow|downtime|outage|crashing|limits)\b/i,
    usability: /\b(clunky|hard to use|ui|ux|confusing|complicated)\b/i,
    support: /\b(support|customer service|ignored|ghosted|unhelpful)\b/i,
    technical: /\b(bug|buggy|broken|error|integration|api|webhook)\b/i
};
export function detectPainSignals(text) {
    const painTypes = [];
    let severity = 0;
    for (const [type, regex] of Object.entries(PAIN_PATTERNS)) {
        if (regex.test(text)) {
            painTypes.push(type);
            severity += 0.2;
        }
    }
    return {
        hasPainSignal: painTypes.length > 0,
        painTypes,
        severity: Math.min(1, severity),
        confidence: painTypes.length > 0 ? 0.7 : 0
    };
}
