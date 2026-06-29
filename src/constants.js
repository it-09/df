// Pipeline Configuration Constants
// Tune these thresholds to control precision vs recall tradeoff

// Minimum LLM confidence threshold (0.0 - 1.0)
// Signals below this are rejected even if isGenuineBuyer = true
// Higher = more strict (fewer but higher quality leads)
export const MIN_CONFIDENCE_THRESHOLD = 0.75;

// Minimum topic relevance score (0.0 - 1.0)
// Signals below this are rejected as not about the searched topic
export const MIN_TOPIC_RELEVANCE_SCORE = 0.4;

// Maximum results per query
export const MAX_RESULTS_PER_QUERY = 50;

// LLM batch size for parallel evaluation
export const LLM_BATCH_SIZE = 10;

// LLM timeout in milliseconds
export const LLM_TIMEOUT_MS = 15000;

// Signal age limits
export const MAX_SIGNAL_AGE_DAYS = 90;
export const HOT_SIGNAL_DAYS = 7;
export const RECENT_SIGNAL_DAYS = 30;

// Intent score thresholds
export const INTENT_SCORE_HIGH = 60;
export const INTENT_SCORE_MEDIUM = 30;
export const INTENT_SCORE_LLM_GATE = 40;
