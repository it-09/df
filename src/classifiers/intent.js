// Intent and buying signal classifier

// Keyword patterns for different buying signals
const BUDGET_KEYWORDS = [
    'pricing', 'price', 'cost', 'budget', 'expensive', 'cheap', 'affordable',
    'roi', 'return on investment', 'worth it', 'pricing tier', 'subscription',
    'free tier', 'enterprise pricing', 'discount', 'license', 'pay', 'pricing complaints',
    'overpriced', 'not worth', 'too costly', 'monthly fee', 'annual fee', 'renew',
    'renewal', 'price hike', 'price increase', 'billing', 'invoice', 'seat cost',
    'per user', 'per seat', 'per month', 'price gouging', 'locked in', 'contract price'
];

const TIMELINE_KEYWORDS = [
    'urgent', 'asap', 'immediately', 'deadline', 'quarter', 'q1', 'q2', 'q3', 'q4',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'next month', 'this month',
    'next week', 'tomorrow', 'soon', 'planning to', 'looking to',
    'by end of', 'end of year', 'eoy', 'before the end', 'running out of time',
    'need this by', 'must have by', 'sprint', 'roadmap', 'migration deadline'
];

const TECHNICAL_KEYWORDS = [
    'integration', 'api', 'sdk', 'plugin', 'connector', 'webhook', 'oauth',
    'security', 'compliance', 'gdpr', 'hipaa', 'soc2', 'iso',
    'performance', 'scalability', 'uptime', 'sla', 'latency',
    'migration', 'onboarding', 'implementation', 'setup',
    'api limitations', 'rate limits', 'integration pain', 'scaling problems',
    'developer complaints', 'workflow blockers', 'technical blockers', 'implementation pain',
    'data export', 'data import', 'custom field', 'no native', 'lacks integration',
    'hard to integrate', 'poor api', 'missing api', 'workflow automation', 'zapier',
    'make.com', 'n8n', 'data sync', 'crm sync', 'not compatible'
];

const EVALUATION_KEYWORDS = [
    'alternative', 'comparison', 'vs', 'versus', 'better than', 'worse than',
    'switch from', 'migrate from', 'replacing', 'evaluation', 'considering',
    'trial', 'demo', 'poc', 'proof of concept', 'testing', 'trying out',
    'evaluating alternatives', 'looking for alternatives', 'any better option', 'replacing tool',
    'compared to', 'alternatives', 'evaluating',
    'recommendation', 'what do you use', 'what do you recommend', 'anyone tried',
    'anyone using', 'what are people using', 'any suggestions', 'any recommendations',
    'open to suggestions', 'looking to replace', 'shopping for', 'narrowed it down',
    'shortlisted', 'side by side', 'feature comparison', 'which is better'
];

const DECISION_KEYWORDS = [
    'decision', 'approve', 'buy', 'purchase', 'contract', 'agreement',
    'stakeholder', 'team', 'manager', 'cto', 'cfo', 'vp', 'director',
    'recommendation', 'suggest', 'proposal', 'procurement',
    'signed up', 'just purchased', 'we chose', 'we selected', 'went with',
    'final decision', 'made the switch', 'pulling the trigger', 'committed to',
    'budget approved', 'green light', 'got sign off', 'board approved'
];

const FRUSTRATION_KEYWORDS = [
    'fed up', 'terrible', 'frustrated', 'painful', 'awful', 'broken', 'unusable',
    'frustration', 'fed up with', 'moving away from', 'terrible support',
    'churn', 'canceling', 'cancelling',
    // Natural buyer voice - the most common real expressions
    'tired of', 'sick of', 'hate', 'hate using', 'not happy', 'not satisfied',
    'disappointed', 'regret', 'mistake choosing', 'worst decision', 'a nightmare',
    'pain in the ass', 'pain in the neck', 'drives me crazy', 'so frustrated',
    'completely useless', 'waste of money', 'waste of time', 'rip off', 'ripoff',
    'overrated', 'not worth it', 'not what we expected', 'let us down',
    'too complicated', 'overly complicated', 'bloated', 'clunky', 'buggy',
    'keeps crashing', 'always down', 'constant issues', 'outgrew', 'we outgrew',
    'beyond frustrated', 'at our wit', 'had enough', 'done with', 'moving on'
];

const NOISE_KEYWORDS = [
    'is hiring', 'we are hiring', 'join our team', 'files for ipo', 'going public',
    'funding round', 'raised series', 'announces acquisition', 'acquired by',
    'culture code', 'press release', 'honored to be recognized',
    'excited to announce', 'proud to share', 'great place to work', 'news announcement',
    'did y', 'did x', 'generic praise',
    'philosophical commentary', 'culture discussion', 'executive reflections',
    'historical discussion', 'non-commercial discussion'
];

/**
 * Detect noise in text (hiring, IPO, PR, etc)
 * @param {string} text - Text to analyze
 * @returns {Object} - Noise detection result
 */
export function detectNoise(text) {
    if (!text) return { isNoise: false, reason: null };
    const lowerText = text.toLowerCase();
    
    for (const kw of NOISE_KEYWORDS) {
        if (lowerText.includes(kw)) {
            return { isNoise: true, reason: `Matches noise pattern: "${kw}"` };
        }
    }
    
    return { isNoise: false, reason: null };
}

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
            hasFrustrationSignal: false,
            confidence: 0,
            signals: []
        };
    }

    const lowerText = text.toLowerCase();

    const signals = [];
    let score = 0;

    const hasBudgetSignal = BUDGET_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasBudgetSignal) {
        signals.push('budget');
        score += 0.2;
    }

    const hasTimelineSignal = TIMELINE_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasTimelineSignal) {
        signals.push('timeline');
        score += 0.25;
    }

    const hasTechnicalSignal = TECHNICAL_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasTechnicalSignal) {
        signals.push('technical');
        score += 0.15;
    }

    const hasEvaluationSignal = EVALUATION_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasEvaluationSignal) {
        signals.push('evaluation');
        score += 0.3;
    }

    const hasDecisionSignal = DECISION_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasDecisionSignal) {
        signals.push('decision');
        score += 0.2;
    }

    const hasFrustrationSignal = FRUSTRATION_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasFrustrationSignal) {
        signals.push('frustration');
        score += 0.3;
    }

    return {
        hasBudgetSignal,
        hasTimelineSignal,
        hasTechnicalSignal,
        hasEvaluationSignal,
        hasDecisionSignal,
        hasFrustrationSignal,
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
    const competitiveKeywords = ['alternative', 'competitor', 'vs', 'versus', 'better than', 'switch from', 'comparison against', 'compared to', 'evaluating alternatives', 'replacing'];
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
    const { hasBudgetSignal, hasTimelineSignal, hasEvaluationSignal, hasDecisionSignal, hasFrustrationSignal } = buyingSignals;

    if (hasTimelineSignal && hasBudgetSignal && hasDecisionSignal) {
        return 'decision';
    }

    if (hasEvaluationSignal && (hasBudgetSignal || buyingSignals.hasTechnicalSignal || hasFrustrationSignal)) {
        return 'evaluation';
    }

    if (hasEvaluationSignal || hasFrustrationSignal) {
        return 'consideration';
    }

    return 'awareness';
}