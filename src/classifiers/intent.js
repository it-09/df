// Intent and buying signal classifier

// Keyword patterns for different buying signals
const BUDGET_KEYWORDS = [
    'pricing', 'price', 'cost', 'budget', 'expensive', 'cheap', 'affordable',
    'roi', 'return on investment', 'worth it', 'pricing tier', 'subscription',
    'free tier', 'enterprise pricing', 'discount', 'license', 'pay'
];

const TIMELINE_KEYWORDS = [
    'urgent', 'asap', 'immediately', 'deadline', 'quarter', 'q1', 'q2', 'q3', 'q4',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'next month', 'this month',
    'next week', 'tomorrow', 'soon', 'planning to', 'looking to'
];

const TECHNICAL_KEYWORDS = [
    'integration', 'api', 'sdk', 'plugin', 'connector', 'webhook', 'oauth',
    'security', 'compliance', 'gdpr', 'hipaa', 'soc2', 'iso',
    'performance', 'scalability', 'uptime', 'sla', 'latency',
    'migration', 'onboarding', 'implementation', 'setup'
];

const EVALUATION_KEYWORDS = [
    'alternative', 'comparison', 'vs', 'versus', 'better than', 'worse than',
    'switch from', 'migrate from', 'replacing', 'evaluation', 'considering',
    'trial', 'demo', 'poc', 'proof of concept', 'testing', 'trying out'
];

const DECISION_KEYWORDS = [
    'decision', 'approve', 'buy', 'purchase', 'contract', 'agreement',
    'stakeholder', 'team', 'manager', 'cto', 'cfo', 'vp', 'director',
    'recommendation', 'suggest', 'proposal'
];

/**
 * Detect buying signals in text
 * @param {string} text - Text to analyze
 * @returns {Object} - Buying signals detected
 */
export function detectBuyingSignals(text) {
    if (!text) {
        return {
            hasBudgetSignal: false,
            hasTimelineSignal: false,
            hasTechnicalSignal: false,
            hasEvaluationSignal: false,
            hasDecisionSignal: false,
            confidence: 0,
            signals: []
        };
    }

    const lowerText = text.toLowerCase();

    const signals = [];
    let score = 0;

    // Check for budget signals
    const hasBudgetSignal = BUDGET_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasBudgetSignal) {
        signals.push('budget');
        score += 0.2;
    }

    // Check for timeline signals
    const hasTimelineSignal = TIMELINE_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasTimelineSignal) {
        signals.push('timeline');
        score += 0.25;
    }

    // Check for technical signals
    const hasTechnicalSignal = TECHNICAL_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasTechnicalSignal) {
        signals.push('technical');
        score += 0.15;
    }

    // Check for evaluation signals
    const hasEvaluationSignal = EVALUATION_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasEvaluationSignal) {
        signals.push('evaluation');
        score += 0.3;
    }

    // Check for decision signals
    const hasDecisionSignal = DECISION_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasDecisionSignal) {
        signals.push('decision');
        score += 0.2;
    }

    return {
        hasBudgetSignal,
        hasTimelineSignal,
        hasTechnicalSignal,
        hasEvaluationSignal,
        hasDecisionSignal,
        confidence: Math.min(1.0, score),
        signals
    };
}

/**
 * Detect competitor mentions
 * @param {string} text - Text to analyze
 * @param {string[]} knownCompetitors - Known competitor names
 * @returns {Object} - Competitor signals
 */
export function detectCompetitors(text, knownCompetitors = []) {
    if (!text) return { hasCompetitiveSignal: false, competitors: [] };

    const lowerText = text.toLowerCase();
    const mentioned = [];

    for (const competitor of knownCompetitors) {
        if (lowerText.includes(competitor.toLowerCase())) {
            mentioned.push(competitor);
        }
    }

    // Also look for generic competitive signals
    const competitiveKeywords = ['alternative', 'competitor', 'vs', 'versus', 'better than', 'switch from'];
    const hasCompetitiveLanguage = competitiveKeywords.some(kw => lowerText.includes(kw));

    return {
        hasCompetitiveSignal: mentioned.length > 0 || hasCompetitiveLanguage,
        competitors: mentioned
    };
}

/**
 * Predict buying stage from signals
 * @param {Object} buyingSignals - Detected buying signals
 * @param {Object} sentimentData - Sentiment analysis
 * @returns {string} - Predicted stage
 */
export function predictBuyingStage(buyingSignals, sentimentData) {
    const { hasBudgetSignal, hasTimelineSignal, hasEvaluationSignal, hasDecisionSignal } = buyingSignals;

    // Decision stage: timeline + budget + decision keywords
    if (hasTimelineSignal && hasBudgetSignal && hasDecisionSignal) {
        return 'decision';
    }

    // Evaluation stage: evaluation keywords + technical or budget
    if (hasEvaluationSignal && (hasBudgetSignal || buyingSignals.hasTechnicalSignal)) {
        return 'evaluation';
    }

    // Consideration stage: evaluation signals present
    if (hasEvaluationSignal) {
        return 'consideration';
    }

    // Awareness stage: just researching
    return 'awareness';
}