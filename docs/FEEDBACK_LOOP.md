# Human-in-the-Loop Feedback Architecture (V2)

## Goal
To build a long-term data moat, we must allow users (GTM teams) to correct the LLM's classification. Every correction will automatically update the `gold_dataset.json` and improve future few-shot prompting.

## Architecture

### 1. Ingestion Interface
In the Apify Store UI (or via an external dashboard integration), users will view the CRM exports. 
Next to each lead, there will be two buttons:
- 👍 **Good Lead**
- 👎 **Bad Lead (False Positive)**

### 2. Payload Logging
When a user clicks a button, a payload is sent to an Apify webhook containing:
```json
{
  "signalId": "...",
  "feedback": "BAD",
  "reason": "Not a commercial context, just a tutorial.",
  "originalSignal": { ... }
}
```

### 3. Automated Dataset Expansion
A lightweight daily chron job (or Apify Actor) will consume the webhook queue and:
1. Append the `originalSignal` to `gold_dataset.json`.
2. Flip `isGenuineBuyer` to match the user's feedback.
3. Automatically run the `run_benchmark.js` script to flag regressions.

### 4. Dynamic Few-Shot Prompting
Once the dataset reaches a critical mass (e.g., 50 user-corrected false positives), the LLM Evaluator (`src/classifiers/llmEvaluator.js`) will dynamically select the 3 most semantically similar false positives from the dataset and inject them into the system prompt as "Anti-Examples" to guide the LLM away from making the same mistake twice.
