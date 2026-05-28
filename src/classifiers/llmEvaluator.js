import { log } from 'crawlee';
import axios from 'axios';

// Map of legacy pain types for backward compatibility
const VALID_PAIN_TYPES = ['pricing', 'scaling', 'usability', 'support', 'technical'];

/**
 * The system prompt defining the strict rules for B2B buyer intent detection.
 */
const SYSTEM_PROMPT = `You are a ruthless, highly critical B2B Sales Intelligence Analyst.
Your job is to read scraped internet text (Reddit, GitHub, Hacker News) and determine if it represents a GENUINE, ACTIONABLE buying signal for a SaaS sales team.

CRITICAL RULES:
1. REJECT NOISE: 99% of text is noise. You must REJECT (isGenuineBuyer = false) if the text is:
   - A listicle ("10 Best Alternatives to X")
   - A news article or stock market analysis
   - Content marketing, SEO spam, or thought leadership
   - Anime, fiction, video games, or pop culture references
   - A developer complaining about a bug/SDK without commercial intent
   - Someone sharing a personal portfolio project
   - Someone just mentioning a company name in passing

2. ACCEPT TRUE BUYERS: You should ACCEPT (isGenuineBuyer = true) ONLY IF:
   - A real person is actively evaluating vendors or asking for recommendations.
   - A real person is expressing severe dissatisfaction with a current vendor (pricing, support, scaling) that could lead to churn.
   - A real person is explicitly discussing migrating from one tool to another.

If isGenuineBuyer is true, you must provide:
- intentScore: 0 to 100. (100 = "Take my money now", 80 = "Active evaluation", 50 = "General complaint but no active search").
- painPoints: Array of detected pains. Must only be from this list: ["pricing", "scaling", "usability", "support", "technical"].
- switchingFrom: Name of the company they are leaving (if explicitly stated, otherwise null).
- switchingTo: Name of the company they are moving to (if explicitly stated, otherwise null).
- personas: Array of job roles inferred from context (e.g., ["Software Engineer", "VP Sales"]). Keep empty if unknown.
- explanation: A short, 1-sentence explanation of why this is a high intent lead.

If isGenuineBuyer is false, set intentScore to 0, explanation to why it was rejected, and leave other fields empty/null.

OUTPUT FORMAT:
You must output STRICT JSON matching this schema:
{
  "isGenuineBuyer": boolean,
  "intentScore": number,
  "painPoints": string[],
  "switchingFrom": string | null,
  "switchingTo": string | null,
  "personas": string[],
  "explanation": string
}`;

/**
 * Evaluate a signal using OpenAI API.
 * 
 * @param {Object} signal - The raw scraped signal
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<Object>} - The structured evaluation
 */
export async function evaluateSignalWithLLM(signal, apiKey) {
    if (!apiKey) {
        log.warning('No OpenAI API key provided. Falling back to default low intent.');
        return fallbackEvaluation(signal);
    }

    const textToAnalyze = `
TITLE: ${signal.title || 'N/A'}
SOURCE: ${signal.source || 'N/A'}
CONTENT: ${(signal.content || '').substring(0, 1500)}
COMPANY MENTIONED: ${signal.company}
`;

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'openai/gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: textToAnalyze }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1, // Keep it deterministic and strict
            max_tokens: 250
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/apify/dark-funnel',
                'X-Title': 'Dark Funnel Intelligence Engine'
            },
            timeout: 10000
        });

        const resultText = response.data.choices[0].message.content;
        const result = JSON.parse(resultText);

        // Sanitize outputs
        return {
            isGenuineBuyer: !!result.isGenuineBuyer,
            intentScore: typeof result.intentScore === 'number' ? result.intentScore : 0,
            painPoints: Array.isArray(result.painPoints) ? result.painPoints.filter(p => VALID_PAIN_TYPES.includes(p)) : [],
            switchingFrom: result.switchingFrom || null,
            switchingTo: result.switchingTo || null,
            personas: Array.isArray(result.personas) ? result.personas : [],
            explanation: result.explanation || 'No explanation provided.'
        };

    } catch (error) {
        const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        log.error(`LLM Evaluation failed for signal: ${errMsg}`);
        return fallbackEvaluation(signal);
    }
}

/**
 * Fallback evaluation if LLM fails or API key is missing.
 */
function fallbackEvaluation(signal) {
    return {
        isGenuineBuyer: false,
        intentScore: 0,
        painPoints: [],
        switchingFrom: null,
        switchingTo: null,
        personas: [],
        explanation: 'LLM evaluation failed or missing API key.'
    };
}
