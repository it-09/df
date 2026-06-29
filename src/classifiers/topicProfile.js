// Dynamic Topic Profile Builder
// Extracts primary keywords, synonyms, commercial terms, and negative terms
// from any B2B software/topic search query.

/**
 * Synonym map for common B2B topic expansion.
 * Keys are lowercase topic fragments; values are arrays of related terms.
 * Used to expand a user's query into a broader set of relevant keywords.
 */
const SYNONYM_MAP = {
    'receptionist': ['receptionist', 'front desk', 'phone answering', 'call answering', 'call handling', 'answering service'],
    'virtual': ['virtual', 'ai', 'automated', 'automated', 'digital', 'remote'],
    'ai': ['ai', 'artificial intelligence', 'machine learning', 'ml', 'chatbot', 'conversational'],
    'phone': ['phone', 'call', 'telephone', 'voip', 'sip', 'dialer'],
    'crm': ['crm', 'customer relationship management', 'salesforce', 'hubspot', 'contact management'],
    'ats': ['ats', 'applicant tracking system', 'recruiting software', 'hiring platform', 'talent acquisition'],
    'support': ['support', 'helpdesk', 'help desk', 'customer service', 'customer success', 'ticketing'],
    'automation': ['automation', 'automated', 'workflow', 'orchestration', 'integration'],
    'chatbot': ['chatbot', 'chat bot', 'conversational ai', 'messaging bot', 'live chat'],
    'engagement': ['engagement', 'outreach', 'sequences', 'cadence', 'follow-up'],
    'sales': ['sales', 'revenue', 'pipeline', 'prospecting', 'lead generation'],
    'marketing': ['marketing', 'campaign', 'advertising', 'demand generation', 'content marketing'],
    'analytics': ['analytics', 'reporting', 'dashboard', 'metrics', 'kpis', 'insights'],
    'communication': ['communication', 'messaging', 'chat', 'video', 'meetings', 'conferencing'],
    'project management': ['project management', 'task management', 'pm software', 'kanban', 'scrum'],
    'billing': ['billing', 'invoicing', 'subscription management', 'recurring billing', 'payment processing'],
    'security': ['security', 'compliance', 'gdpr', 'hipaa', 'soc2', 'encryption'],
    'integration': ['integration', 'api', 'webhook', 'connector', 'plugin', 'sync'],
    'workflow': ['workflow', 'automation', 'business process', 'bpm', 'orchestration'],
    'onboarding': ['onboarding', 'implementation', 'setup', 'deployment', 'migration'],
    'analytics': ['analytics', 'business intelligence', 'bi', 'data visualization', 'reporting'],
    'collaboration': ['collaboration', 'teamwork', 'shared workspace', 'co-editing', 'real-time'],
    'document': ['document', 'paperwork', 'form', 'template', 'file management'],
    'scheduling': ['scheduling', 'appointment', 'booking', 'calendar', 'availability management'],
    'feedback': ['feedback', 'survey', 'nps', 'customer satisfaction', 'reviews'],
    'onboarding': ['onboarding', 'training', 'ramp', 'enablement', 'adoption'],
    'churn': ['churn', 'retention', 'renewal', 'expansion', 'upsell'],
    'lead': ['lead', 'prospect', 'opportunity', 'deal', 'pipeline'],
    'pipeline': ['pipeline', 'funnel', 'conversion', 'qualification', 'scoring'],
    'outreach': ['outreach', 'sequences', 'cadence', 'cold email', 'cold calling'],
    'personalization': ['personalization', 'segmentation', 'targeting', 'abm', 'account-based'],
    'intent': ['intent', 'buying signals', 'dark funnel', 'signal intelligence', 'buyer intent'],
    'account': ['account', 'customer', 'client', 'enterprise', 'mid-market'],
    'subscription': ['subscription', 'saas', 'recurring', 'monthly', 'annual plan'],
    'enterprise': ['enterprise', 'large business', 'corporate', 'organization', 'team plan'],
    'small business': ['small business', 'smb', 'startup', 'entrepreneur', 'freelancer'],
    'agency': ['agency', 'consultancy', 'service provider', 'partner', 'reseller'],
    'e-commerce': ['e-commerce', 'ecommerce', 'online store', 'shopify', 'woocommerce'],
    'fintech': ['fintech', 'financial technology', 'banking', 'payments', 'lending'],
    'healthcare': ['healthcare', 'health tech', 'medical', 'clinical', 'patient'],
    'education': ['education', 'edtech', 'learning management', 'lms', 'training platform'],
    'real estate': ['real estate', 'property management', 'rental', 'listing', 'broker'],
    'logistics': ['logistics', 'supply chain', 'shipping', 'fulfillment', 'inventory'],
    'hr': ['hr', 'human resources', 'people operations', 'payroll', 'benefits'],
    'recruiting': ['recruiting', 'talent', 'hiring', 'staffing', 'workforce'],
};

/**
 * Commercial intent modifiers that can precede or follow any topic.
 * These signal buying intent when combined with topic keywords.
 */
const COMMERCIAL_MODIFIERS = [
    'pricing', 'price', 'cost', 'budget', 'expensive', 'cheap', 'affordable',
    'roi', 'return on investment', 'worth it', 'too costly', 'overpriced',
    'alternative', 'alternatives to', 'vs', 'versus', 'compared to', 'comparison',
    'better than', 'worse than', 'switching from', 'migrating from', 'leaving',
    'looking for', 'need', 'seeking', 'searching for', 'finding', 'choosing',
    'evaluating', 'considering', 'trial', 'demo', 'proof of concept', 'poc',
    'testing', 'trying out', 'shopping for', 'narrowed it down',
    'recommend', 'recommendation', 'suggestions', 'what do you use',
    'anyone tried', 'anyone using', 'what are people using',
    'frustrated', 'frustrating', 'terrible', 'awful', 'hate', 'sick of',
    'tired of', 'fed up', 'painful', 'broken', 'unusable', 'disappointed',
    'regret', 'worst decision', 'waste of money', 'rip off',
    'canceling', 'cancelling', 'churning', 'moving away', 'done with',
    'implementation', 'integration', 'api', 'migration', 'onboarding',
    'switching to', 'moved to', 'now using', 'just switched', 'just migrated',
    'decision', 'approve', 'buy', 'purchase', 'contract', 'signed up',
    'budget approved', 'green light', 'got sign off',
];

/**
 * Negative terms that indicate non-commercial or irrelevant content.
 * Posts matching these heavily are likely not B2B buying signals.
 */
const UNIVERSAL_NEGATIVE_TERMS = [
    'ebay', 'amazon', 'etsy', 'craigslist', 'facebook marketplace',
    'mercari', 'poshmark', 'offerup', 'letgo', 'depop',
    'buy now', 'free shipping', 'add to cart', 'check out my',
    'selling my', 'for sale', 'auction', 'bid', 'listing price',
    'i worked as', 'my experience as', 'i got fired', 'my career as',
    'i was a receptionist', 'when i was a', 'my job as',
    'lol', 'lmao', 'omg', 'hilarious', 'funny', 'meme', 'shitpost',
    'rofl', 'bruh', 'smh', 'fml', 'tbh', 'imo', 'imho',
    'what is ai', 'future of ai', 'ai is taking over', 'ai revolution',
    'ai ethics', 'ai safety', 'ai research', 'neural network',
    'research paper', 'study', 'journal', 'university', 'professor', 'thesis',
    'funding round', 'series a', 'series b', 'ipo', 'acquired', 'acquisition',
    'press release', 'announces', 'raises', 'valuation', 'unicorn',
    'looking for a job', 'hiring', 'resume', 'i need work', 'job posting',
    'my house', 'my apartment', 'personal use', 'home use', 'for my home',
    'movie', 'tv show', 'netflix', 'youtube video', 'tiktok', 'instagram',
    'podcast episode', 'book', 'novel', 'fiction', 'story',
];

/**
 * Build a topic profile from a search query string.
 * Dynamically extracts and expands keywords for any B2B topic.
 *
 * @param {string} query - The user's search query (e.g., "AI receptionist", "CRM", "customer support automation")
 * @returns {Object} Topic profile with primary, related, commercial, and negative keyword sets
 */
export function buildTopicProfile(query) {
    if (!query || typeof query !== 'string') {
        return { primary: [], related: [], commercial: [], negative: [] };
    }

    const normalizedQuery = query.toLowerCase().trim();
    const queryWords = normalizedQuery.split(/\s+/);

    // 1. Primary keywords: the exact query and its core variations
    const primary = new Set([normalizedQuery]);

    // Add individual query words if they are significant (not stop words)
    const stopWords = new Set(['a', 'an', 'the', 'for', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'is', 'it', 'my', 'our', 'your']);
    for (const word of queryWords) {
        if (!stopWords.has(word) && word.length >= 2) {
            primary.add(word);
        }
    }

    // 2. Related keywords: expand via synonym map
    const related = new Set();
    for (const word of queryWords) {
        if (SYNONYM_MAP[word]) {
            for (const synonym of SYNONYM_MAP[word]) {
                if (!primary.has(synonym)) {
                    related.add(synonym);
                }
            }
        }
        // Also check multi-word combinations
        for (const key of Object.keys(SYNONYM_MAP)) {
            if (normalizedQuery.includes(key)) {
                for (const synonym of SYNONYM_MAP[key]) {
                    if (!primary.has(synonym)) {
                        related.add(synonym);
                    }
                }
            }
        }
    }

    // Build compound related terms from query + common suffixes/prefixes
    const compoundTerms = [];
    for (const word of queryWords) {
        if (stopWords.has(word)) continue;
        compoundTerms.push(word);
    }
    if (compoundTerms.length > 0) {
        const base = compoundTerms.join(' ');
        related.add(`${base} software`);
        related.add(`${base} tool`);
        related.add(`${base} platform`);
        related.add(`${base} solution`);
        related.add(`${base} service`);
        related.add(`${base} system`);
        related.add(`best ${base}`);
        related.add(`top ${base}`);
        related.add(`${base} comparison`);
        related.add(`${base} pricing`);
    }

    // 3. Commercial intent keywords (always included)
    const commercial = new Set(COMMERCIAL_MODIFIERS);

    // 4. Negative keywords (always included)
    const negative = new Set(UNIVERSAL_NEGATIVE_TERMS);

    return {
        primary: [...primary],
        related: [...related],
        commercial: [...commercial],
        negative: [...negative],
        originalQuery: query,
    };
}
