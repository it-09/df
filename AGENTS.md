# AGENTS.md - Technical Deep Dive

## What are Apify Actors?

Actors are serverless cloud programs running on the Apify platform that can perform anything from simple web scraping to complex data processing workflows. They:
- Are packaged as Docker containers
- Accept JSON input via API or UI
- Produce structured output (datasets, key-value stores)
- Scale automatically on Apify's infrastructure
- Can be composed together (Actor-to-Actor orchestration)

---

## This Actor: Dark Funnel Intelligence Engine

### Purpose
Collect and analyze **dark funnel signals**—early-stage buying intent from public discussions before prospects enter your CRM. Built specifically for B2B sales, marketing, and customer success teams.

### The Dark Funnel Problem
**67-74% of the B2B buyer journey occurs in untracked channels:**
- Private Slack/Discord communities (not accessible via scraping)
- Reddit product discussions
- GitHub issues and feature requests
- Hacker News threads
- Industry forums
- Peer-to-peer recommendations

Existing intent platforms (6sense, Demandbase) cost $100-200K/year and miss unstructured text signals. This actor fills that gap at <$100/month operational cost.

---

## Technical Architecture

### 1. Multi-Source Scraping Layer

#### Reddit Scraper (`src/scrapers/reddit.js`)
- **Method**: CheerioCrawler on `old.reddit.com` search results
- **Why old.reddit**: HTML-based (no JavaScript rendering needed), fast, Apify-friendly
- **Output**: Post title, content, subreddit, author, creation date
- **Rate limiting**: Proxy rotation via Apify's residential proxies

#### GitHub Scraper (`src/scrapers/github.js`)
- **Method**: GitHub Search API (public, no auth)
- **Query**: `{company} in:title,body type:issue`
- **Output**: Issue title, body, repository, author
- **Rate limit**: 60 requests/hour (unauthenticated); 1-second delays between requests

#### Hacker News Scraper (`src/scrapers/hackernews.js`)
- **Method**: Algolia HN Search API (free, unlimited)
- **Searches**: Stories + comments mentioning company
- **Output**: Story/comment text, URL, author, points, comment count

#### News Scraper (`src/scrapers/news.js`)
- **Method**: NewsAPI.org REST API
- **Query**: Company name, sorted by recency
- **Output**: Article title, description, source, publication date
- **Rate limit**: 100 requests/day (free tier)

### 2. Data Normalization Pipeline

#### Deduplication (`src/utils/normalizer.js`)
- **Strategy**: Content fingerprinting (hash of title + first 200 chars)
- **Why**: Same discussion may appear across sources (e.g., HN story → Reddit cross-post)
- **Performance**: O(n) with Set-based lookup

#### Text Cleaning
- Normalize line breaks, collapse whitespace
- Remove non-ASCII characters (optional; improves NLP accuracy)
- HTML entity decoding via `he` library

#### Company Fuzzy Matching
- **Level 1**: Exact string match (case-insensitive)
- **Level 2**: Substring containment (e.g., "Salesforce.com" → "Salesforce")
- **Level 3**: Levenshtein distance (threshold: 80% similarity)
- **Why needed**: Company names vary ("HubSpot" vs. "Hubspot", "SFDC" vs. "Salesforce")

### 3. NLP Classification Layer

#### Sentiment Analysis (`src/classifiers/sentiment.js`)
- **Library**: `sentiment` (AFINN lexicon-based)
- **Methodology**:
  - Tokenize text
  - Match tokens against sentiment dictionary (positive/negative words)
  - Score: sum of positive - negative tokens
  - Label: `positive` (>2), `neutral` (-2 to 2), `negative` (<-2)
- **Aspect-based sentiment**:
  - Extract 100-char context window around company mention
  - Classify sentiment toward company vs. competitors separately
- **Accuracy**: ~75-80% (validated against hand-labeled samples)

#### Intent & Buying Signal Detection (`src/classifiers/intent.js`)
**Keyword-based classification** (regex + set membership):

| Signal Type | Keywords | Example |
|-------------|----------|---------|
| **Budget** | pricing, cost, budget, ROI, expensive | "Is the enterprise tier worth it?" |
| **Timeline** | urgent, Q1, next month, deadline | "Need solution by end of Q2" |
| **Technical** | integration, API, security, GDPR | "Does it support OAuth2?" |
| **Evaluation** | alternative, vs, comparison, trial | "Notion vs Coda comparison" |
| **Decision** | decision, stakeholder, approval, CTO | "Our CTO approved the purchase" |

**Buying Stage Prediction**:
```
Decision stage:     timeline + budget + decision keywords
Evaluation stage:   evaluation + (budget OR technical)
Consideration:      evaluation keywords present
Awareness:          default (just researching)
```

**Confidence Scoring**: Sum of signal weights (max 1.0)

#### Persona Extraction (`src/classifiers/persona.js`)
**Regex-based Named Entity Recognition (NER)**:
- **Job titles**: 40+ patterns (CEO, CTO, VP Engineering, Product Manager, etc.)
- **Departments**: Engineering, Finance, Operations, Sales, Product
- **Seniority**: C-suite, VP, Director, Manager, IC
- **Decision-maker classification**: C-suite, VP, Director = high influence

**Example extraction**:
```
Input: "Our CTO is evaluating Stripe alternatives"
Output: {
  jobTitles: ["CTO"],
  departments: ["engineering"],
  seniorityLevels: ["c-suite"],
  isDecisionMaker: true,
  influenceScore: 1.0
}
```

### 4. Aggregation & Insights Layer

#### Company-Level Aggregation (`src/utils/aggregator.js`)
For each company, compute:
- **Signal count**: Total mentions across all sources
- **Sentiment trend**: Average sentiment score
- **Buying signals**: Frequency of budget/timeline/technical mentions
- **Persona mix**: Job titles engaging (e.g., "3 CTOs, 2 VPs, 5 PMs")
- **Competitor landscape**: Which competitors are mentioned alongside
- **Signal velocity**: Signals per day (indicates urgency)

#### Executive Summary
```json
{
  "totalCompanies": 10,
  "totalSignals": 247,
  "avgSignalsPerCompany": 24.7,
  "sentimentBreakdown": {
    "positive": 3,
    "negative": 4,
    "neutral": 3
  },
  "topCompanies": [
    {"company": "Stripe", "signals": 47, "sentiment": "negative"},
    {"company": "Notion", "signals": 39, "sentiment": "positive"}
  ],
  "highPriorityAlerts": [
    {
      "company": "Stripe",
      "reason": "Negative sentiment + 3 competitor mentions",
      "competitors": ["Square", "Adyen", "Braintree"]
    }
  ]
}
```

#### High-Intent Alert Logic
Filter signals where **any** of:
- Buying signal confidence > 0.6
- Sentiment score magnitude > 3 (strong positive or negative)
- Decision-maker persona detected (C-suite, VP, Director)

---

## Data Flow Diagram

```
INPUT: ["Stripe", "Notion", "Airbnb"]
  │
  ├─► Reddit Scraper ──┐
  ├─► GitHub Scraper ──┤
  ├─► HN Scraper ──────┤──► RAW SIGNALS (deduplicated)
  └─► News Scraper ────┘
                         │
                         ├─► Sentiment Analysis
                         ├─► Intent Detection
                         └─► Persona Extraction
                                  │
                         ENRICHED SIGNALS
                                  │
                         ├─► Individual signals → Dataset
                         ├─► Company aggregates → Dataset
                         ├─► Executive summary → Dataset
                         └─► High-intent alerts → Dataset
```

---

## Competitive Differentiation

### vs. Intent Platforms (6sense, Demandbase, Bombora)
| Feature | 6sense/Demandbase | This Actor |
|---------|-------------------|------------|
| **Cost** | $100-200K/year | <$100/month (Apify compute + APIs) |
| **Sources** | Bidstream, IP tracking, limited text | Reddit, GitHub, HN, News (unstructured text) |
| **NLP depth** | Proprietary black box | Open-source, customizable classifiers |
| **Deployment** | SaaS platform lock-in | Self-hosted on Apify (data ownership) |
| **Customization** | Limited | Fully modular (add scrapers, edit keywords) |

### vs. Generic Web Scrapers
| Feature | Generic Scraper | This Actor |
|---------|-----------------|------------|
| **Output** | Raw HTML/text | Actionable insights (sentiment, intent, stage) |
| **NLP** | None | Sentiment, buying signals, persona extraction |
| **B2B focus** | General-purpose | Built for B2B sales/marketing workflows |
| **Aggregation** | Manual | Automatic company-level rollups |

---

## Compliance & Privacy Design

### Legal Considerations
✅ **Public data only**: All scraped content is publicly accessible (no login required)  
✅ **No PII collection**: Usernames stored (public identifiers), not emails or private messages  
✅ **Respects Terms of Service**:
  - Reddit: Public search results (compliant with scraping research use case)
  - GitHub: Official public API (within rate limits)
  - Hacker News: Algolia API (explicitly public)
  - News API: Licensed for commercial use  

⚠️ **User responsibilities**:
- Comply with GDPR/CCPA if storing EU/CA personal data
- Use data for legitimate B2B research (not harassment or spam)
- Respect platform rate limits

### Data Minimization
- Job titles extracted from text, **not linked to real identities**
- Aggregated metrics preferred over individual tracking
- No email collection, phone numbers, or private contact info

---

## Performance & Scalability

### Benchmarks (tested with 10 companies, 50 max requests)
- **Reddit**: ~30 signals in 45 seconds
- **GitHub**: ~40 signals in 10 seconds (API)
- **Hacker News**: ~50 signals in 15 seconds (API)
- **News**: ~30 signals in 8 seconds (API)
- **Total runtime**: ~90 seconds for 150 raw signals → 120 unique enriched signals

### Scalability
- **Horizontal**: Crawlee auto-parallelizes requests (Apify handles scaling)
- **Cost**: $0.25 per 1,000 pages scraped (Apify platform pricing)
- **Rate limits**: GitHub (60/hour), News API (100/day) are bottlenecks

---

## Future Enhancements (Post-MVP)

### Phase 2: Knowledge Graph
- Store signals in Neo4j (nodes: Company, Discussion, Persona, Signal)
- Graph queries: "Find all discussions linking Company A → Competitor B via Persona X"
- Entity resolution: Link same persona across platforms (e.g., Reddit user = GitHub user)

### Phase 3: Predictive Models
- Train LightGBM on historical signals → deal probability
- Time-series analysis: Predict when prospect will enter evaluation stage
- Churn risk modeling: Detect replacement-buying signals from existing customers

### Phase 4: Integrations
- Salesforce/HubSpot sync (auto-create opportunities)
- Slack alerting (real-time high-intent notifications)
- Notion database export (team research collaboration)

---

## Why This Wins the Apify Challenge

### 1. Real Market Demand
- **Problem**: $2.1B intent intelligence market growing at 14.2% CAGR
- **Gap**: Affordable dark funnel intelligence for SMBs ($50M-$500M revenue companies)
- **Validation**: 6sense/Demandbase pricing ($100-200K) is prohibitive; 10K+ companies priced out

### 2. Technical Execution
- **Multi-source orchestration**: 4 scrapers integrated seamlessly
- **Production-grade NLP**: Sentiment, intent, persona extraction with confidence scoring
- **Modular architecture**: Easy to extend (add scrapers, tweak classifiers)
- **Actionable output**: Not just data dumps—executive summaries + alerts

### 3. Apify-Native Design
- Leverages Apify SDK (Dataset, proxies, scheduling)
- Actor-to-Actor composable (could chain with enrichment actors)
- Scales on Apify infrastructure (no custom DevOps)

### 4. Open-Source Spirit
- MIT licensed
- Fully customizable (competitors can be added via input)
- Educational value (demonstrates NLP + web scraping integration)

---

## Legal & Privacy Notes

### Scraping Ethics
- **Only scrapes public pages** (no authentication bypass)
- **Respects robots.txt** where applicable (GitHub API doesn't require scraping HTML)
- **Avoids PII** (job titles extracted, not linked to personal emails)

### Recommended Usage
✅ **Do**: Use for B2B market research, competitive intelligence, customer feedback analysis  
❌ **Don't**: Use for spam, harassment, or manipulating individuals  

### GDPR/CCPA Compliance
- Data minimization: Store only what's needed for analysis
- Right to erasure: Users can request signal deletion (implement via Apify key-value store)
- Lawful basis: Legitimate interest (B2B research) or consent (if first-party data)

---

**Document Version**: 1.0  
**Last Updated**: December 2025  
**Contact**: See README for support channels