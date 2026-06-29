import { log } from 'crawlee';
import axios from 'axios';
import { LLM_TIMEOUT_MS, MIN_CONFIDENCE_THRESHOLD } from '../constants.js';

// Map of valid pain types for structured output
const VALID_PAIN_TYPES = ['pricing', 'scaling', 'usability', 'support', 'technical'];

// Valid buyer stages
const VALID_BUYER_STAGES = ['awareness', 'consideration', 'evaluation', 'decision'];

// Valid commercial signals
const VALID_COMMERCIAL_SIGNALS = [
    'evaluating', 'comparing', 'requesting', 'switching',
    'implementation', 'migration', 'pain_expressed', 'budget_discussed',
];

/**
 * System prompt for enterprise B2B lead qualification.
 * This prompt is designed to be ruthless about quality — it should reject
 * 90%+ of content as noise and only accept genuine buying signals.
 */
const SYSTEM_PROMPT = `You are an enterprise B2B lead qualification engine. Your ONLY job is to determine if a scraped internet post represents a REAL, ACTIONABLE buying signal that a B2B salesperson would want to pursue.

You are optimizing for PRECISION, not recall. It is better to reject a borderline lead than to accept a false positive. A salesperson's time is expensive — only surface leads that are clearly genuine.

INPUT CONTEXT:
- Search Query: The topic/product category the user is looking for (provided in the user message)
- Source: Where this content was scraped from

STRICT REJECTION RULES (isGenuineBuyer = false):
You MUST reject the content if it is ANY of the following:

1. MARKETPLACE LISTINGS: eBay, Amazon, Etsy, Craigslist, Facebook Marketplace, Shopify storefronts, product listings with prices
2. PERSONAL STORIES: Someone recounting their career as a receptionist, personal anecdotes, "I worked as..." stories
3. MEMES / JOKES: Humorous content, shitposts, satire, anything primarily intended to be funny
4. GENERIC AI DISCUSSIONS: "What is AI?", "Future of AI", "AI ethics", ChatGPT discussions, LLM debates — unless clearly about evaluating a specific product
5. ACADEMIC CONTENT: Research papers, theses, university studies, journal articles
6. NEWS / BUZZ: Funding announcements, IPO news, acquisitions, press releases, "Company raises $X"
7. JOB SEEKERS: Resume posts, "looking for work", "hiring" posts, freelancer pitches
8. NON-B2B CONTENT: Personal use ("for my apartment"), home use, family use, entertainment (movies, TV shows, games)
9. SEO LISTICLES: "Top 10 Best AI Receptionists", ranking articles, content marketing
10. PASSING MENTIONS: The topic is mentioned in passing but the post is about something else entirely
11. DEVELOPER ISSUES: Bug reports, SDK complaints, API errors — unless clearly about switching/commercial impact
12. HIRING / CULTURE: "We are hiring", company culture posts, job announcements

STRICT ACCEPTANCE RULES (isGenuineBuyer = true):
You should ONLY accept if ALL of the following are true:

1. The author is discussing a REAL BUSINESS NEED (not personal use)
2. There is EXPLICIT BUYING INTENT — the author is:
   - Actively evaluating or comparing software/solutions
   - Requesting recommendations from peers
   - Discussing switching from one solution to another
   - Expressing operational pain that would lead to a purchase
   - Asking about pricing, implementation, or integration
   - Mentioning a decision timeline or budget
3. The post is DIRECTLY about the searched topic (not a passing mention)
4. The author appears to be a REAL PERSON (not a brand, bot, or content marketer)
5. A B2B salesperson reading this would think "I should contact this person"

BUYER STAGE CLASSIFICATION:
- "awareness": Just realizing they have a problem, starting to research
- "consideration": Actively looking at options, asking for recommendations
- "evaluation": Comparing specific solutions, requesting demos/trials
- "decision": Ready to buy, discussing budget, final decision

PAIN POINTS (only if explicitly mentioned or strongly implied):
- "pricing": Cost concerns, expensive, budget issues, pricing complaints
- "scaling": Can't scale, performance issues, outgrown current solution
- "usability": Hard to use, confusing UI, poor UX, training required
- "support": Bad customer service, slow support, unresponsive vendor
- "technical": Integration issues, API problems, missing features, compatibility

COMMERCIAL SIGNALS (detect which apply):
- "evaluating": Actively assessing options
- "comparing": Side-by-side comparison of solutions
- "requesting": Asking for recommendations or suggestions
- "switching": Discussing moving from one solution to another
- "implementation": Discussing setup, onboarding, or deployment
- "migration": Discussing data migration or system transition
- "pain_expressed": Clearly stating dissatisfaction with current solution
- "budget_discussed": Mentioning budget, cost, or pricing concerns

OUTPUT FORMAT:
You must output STRICT JSON matching this schema:
{
  "decision": "accept" or "reject",
  "confidence": number between 0.0 and 1.0 (how confident are you this is a genuine buying signal?),
  "buyerStage": one of: "awareness", "consideration", "evaluation", "decision",
  "painPoints": array of strings from: ["pricing", "scaling", "usability", "support", "technical"],
  "commercialSignals": array of strings from the commercial signals list above,
  "explanation": string (1-2 sentences explaining your decision)
}

CRITICAL: Be RUTHLESS. If you are not at least 80% confident this is a genuine buying signal, REJECT it. The cost of a false positive (wasting a salesperson's time) is much higher than the cost of a missed lead.`;

/**
 * Evaluate a signal using OpenAI API (via OpenRouter).
 *
 * @param {Object} signal - The signal to evaluate
 * @param {string} apiKey - OpenAI API key (for OpenRouter)
 * @param {string} searchQuery - The original search query for context
 * @returns {Promise<Object>} - The structured evaluation
 */
export async function evaluateSignalWithLLM(signal, apiKey, searchQuery = '') {
    if (!apiKey) {
        log.warning('No OpenAI API key provided. Falling back to default low intent.');
        return fallbackEvaluation(signal);
    }

    const textToAnalyze = `
SEARCH QUERY: ${searchQuery || 'Not specified'}
SOURCE: ${signal.source || 'Unknown'}
SUBREDDIT: ${signal.subreddit || 'N/A'}
TITLE: ${signal.title || 'N/A'}
CONTENT: ${(signal.content || '').substring(0, 1500)}
COMPANY MENTIONED: ${signal.company || 'N/A'}
URL: ${signal.url || 'N/A'}
`;

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'openai/gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: textToAnalyze }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.05, // Ultra-deterministic for consistency
            max_tokens: 400
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/apify/dark-funnel',
                'X-Title': 'Dark Funnel Intelligence Engine'
            },
            timeout: LLM_TIMEOUT_MS
        });

        const resultText = response.data.choices[0].message.content;
        const result = JSON.parse(resultText);

        // Sanitize and validate outputs
        const decision = result.decision === 'accept' ? 'accept' : 'reject';
        const confidence = typeof result.confidence === 'number'
            ? Math.max(0, Math.min(1, result.confidence))
            : 0;
        const buyerStage = VALID_BUYER_STAGES.includes(result.buyerStage)
            ? result.buyerStage
            : 'awareness';
        const painPoints = Array.isArray(result.painPoints)
            ? result.painPoints.filter(p => VALID_PAIN_TYPES.includes(p))
            : [];
        const commercialSignals = Array.isArray(result.commercialSignals)
            ? result.commercialSignals.filter(s => VALID_COMMERCIAL_SIGNALS.includes(s))
            : [];
        const explanation = typeof result.explanation === 'string'
            ? result.explanation
            : 'No explanation provided.';

        return {
            decision,
            confidence,
            isGenuineBuyer: decision === 'accept' && confidence >= MIN_CONFIDENCE_THRESHOLD,
            intentScore: decision === 'accept' ? Math.round(confidence * 100) : 0,
            buyerStage,
            painPoints,
            commercialSignals,
            switchingFrom: result.switchingFrom || null,
            switchingTo: result.switchingTo || null,
            personas: Array.isArray(result.personas) ? result.personas : [],
            explanation,
        };

    } catch (error) {
        const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        log.error(`LLM Evaluation failed for signal: ${errMsg}`);
        return fallbackEvaluation(signal);
    }
}

/**
 * Fallback evaluation if LLM fails or API key is missing.
 * Conservative: rejects everything by default.
 */
function fallbackEvaluation(signal) {
    return {
        decision: 'reject',
        confidence: 0,
        isGenuineBuyer: false,
        intentScore: 0,
        buyerStage: 'awareness',
        painPoints: [],
        commercialSignals: [],
        switchingFrom: null,
        switchingTo: null,
        personas: [],
        explanation: 'LLM evaluation failed or missing API key. Conservative rejection applied.',
    };
}
