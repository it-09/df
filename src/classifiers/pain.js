const PAIN_PATTERNS = {
    pricing:     /(too expensive|cost|pricing|price|budget|roi|cheaper|overpriced|not worth|price hike|price increase|billing issue|hidden fee|seat cost|per user cost|per month|locked in|contract price|price goug|renewal cost|inflated price)/i,
    scaling:     /(scale|scaling|slow|downtime|outage|crash|limits|performance issue|speed|laggy|lag|throttl|rate limit|capacity|bandwidth|memory|time.?out|not scalable|hit the limit)/i,
    usability:   /(clunky|hard to use|ui|ux|confusing|complicated|not intuitive|steep learning curve|difficult to navigate|poor design|unintuitive|messy|convoluted|not user.friendly|takes forever|too many clicks|overly complex|bloated|bad interface|bad experience|hate the ui|poorly designed)/i,
    support:     /(support|customer service|ignored|ghosted|unhelpful|no response|slow response|terrible support|bad support|poor support|awful support|support team|account manager|customer success|no help|useless support|unresponsive)/i,
    technical:   /(bug|buggy|broken|error|integration|api|webhook|crash|sync issue|data loss|missing feature|limitation|no native|lacks|doesn.t support|can.t integrate|export|import|compatibility|workaround|not compatible)/i,
    feature_gap: /(wish it had|missing feature|need a feature|doesn.t have|lacks|no support for|can.t do|not possible|feature request|feature gap|would love if|if only it had|should have|needs to have|basic feature missing|fundamental gap)/i,
    vendor_lock: /(locked in|hard to leave|can.t export|data hostage|vendor lock|switching cost|hard to migrate|migration nightmare|expensive to leave|exit fee|cancellation fee|trapped)/i
};

const HIGH_VALUE_COMBOS = [ 
    { types: ['pricing', 'vendor_lock'], multiplier: 1.4 }, 
    { types: ['pricing', 'feature_gap'], multiplier: 1.3 }, 
    { types: ['scaling', 'technical'], multiplier: 1.25 }, 
    { types: ['support', 'usability'], multiplier: 1.2 }, 
];

export function detectPainSignals(text) {
    const painTypes = [];
    let severity = 0;
    let totalWeight = 0;

    // Severity weights — some pains are stronger buying signals than others
    const weights = {
        pricing: 0.35,
        vendor_lock: 0.30,
        feature_gap: 0.25,
        support: 0.25,
        technical: 0.20,
        usability: 0.20,
        scaling: 0.20,
    };

    for (const [type, regex] of Object.entries(PAIN_PATTERNS)) {
        if (regex.test(text)) {
            painTypes.push(type);
            severity += weights[type] || 0.2;
            totalWeight++;
        }
    }

    // Compound pain boost: multiple pain types = more severe
    if (totalWeight >= 3) severity = Math.min(1, severity + 0.15);
    
    // Check for high-value combos and apply highest multiplier
    let matchedCombo = null;
    let highestMultiplier = 1;
    for (const combo of HIGH_VALUE_COMBOS) {
        const comboTypesPresent = combo.types.every(type => painTypes.includes(type));
        if (comboTypesPresent && combo.multiplier > highestMultiplier) {
            highestMultiplier = combo.multiplier;
            matchedCombo = combo;
        }
    }
    if (matchedCombo) {
        severity = Math.min(1, severity * highestMultiplier);
    }

    return {
        hasPainSignal: painTypes.length > 0,
        painTypes,
        severity: Math.min(1, severity),
        confidence: painTypes.length > 0 ? Math.min(0.95, 0.5 + painTypes.length * 0.15) : 0,
        compoundComboMatched: matchedCombo ? matchedCombo.types.join('+') : null
    };
}
