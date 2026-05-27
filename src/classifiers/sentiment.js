// Sentiment analysis module
import Sentiment from 'sentiment';

const sentiment = new Sentiment();

/**
 * Analyze sentiment of text
 * @param {string} text - Text to analyze
 * @returns {Object} - Sentiment analysis result
 */
export function analyzeSentiment(text) {
    if (!text || text.trim().length === 0) {
        return {
            score: 0,
            comparative: 0,
            label: 'neutral',
            tokens: [],
            positive: [],
            negative: []
        };
    }

    const result = sentiment.analyze(text);

    // Classify based on score
    let label = 'neutral';
    if (result.score > 2) label = 'positive';
    else if (result.score < -2) label = 'negative';

    return {
        score: result.score,
        comparative: result.comparative,
        label,
        tokens: result.tokens || [],
        positive: result.positive || [],
        negative: result.negative || []
    };
}

/**
 * Analyze sentiment specifically about a company vs competitors
 * @param {string} text - Text to analyze
 * @param {string} company - Company name
 * @param {string[]} competitors - Competitor names
 * @returns {Object} - Aspect-based sentiment
 */
export function analyzeAspectSentiment(text, company, competitors = []) {
    const overallSentiment = analyzeSentiment(text);

    // Simple aspect-based analysis: check if company/competitor is near positive/negative words
    const lowerText = text.toLowerCase();
    const companyLower = company.toLowerCase();

    const result = {
        overall: overallSentiment,
        towardCompany: 'neutral',
        towardCompetitors: 'neutral',
        competitorMentions: []
    };

    // Check if company is mentioned near positive/negative words
    const companyPos = lowerText.indexOf(companyLower);
    if (companyPos !== -1) {
        const context = lowerText.substring(Math.max(0, companyPos - 100), Math.min(lowerText.length, companyPos + 100));
        const contextSentiment = analyzeSentiment(context);
        result.towardCompany = contextSentiment.label;
    }

    // Check competitor mentions
    for (const competitor of competitors) {
        const competitorLower = competitor.toLowerCase();
        if (lowerText.includes(competitorLower)) {
            result.competitorMentions.push(competitor);
            const compPos = lowerText.indexOf(competitorLower);
            const context = lowerText.substring(Math.max(0, compPos - 100), Math.min(lowerText.length, compPos + 100));
            const contextSentiment = analyzeSentiment(context);
            if (contextSentiment.score !== 0) {
                result.towardCompetitors = contextSentiment.label;
            }
        }
    }

    return result;
}