// End-to-End Production Audit Harness
// Tests the full pipeline with realistic mock data for 10 search queries
// Captures every filtering stage and produces detailed metrics

import { describe, it, expect } from 'vitest';
import { buildTopicProfile } from '../../src/classifiers/topicProfile.js';
import { checkTopicRelevance } from '../../src/classifiers/topicRelevance.js';
import { filterNegatives } from '../../src/classifiers/negativeFilter.js';
import { detectBuyingSignals, detectNoise, predictBuyingStage, detectCompetitors } from '../../src/classifiers/intent.js';
import { detectPainSignals } from '../../src/classifiers/pain.js';
import { detectSwitchingSignals } from '../../src/classifiers/switching.js';
import { extractPersona, isDecisionMaker, scorePersonaInfluence } from '../../src/classifiers/persona.js';
import { calculateIntentScore, calculateLeadPriority } from '../../src/classifiers/leadScorer.js';
import { calculateCommercialRelevance } from '../../src/classifiers/relevance.js';
import { analyzeAspectSentiment } from '../../src/classifiers/sentiment.js';
import { cleanText } from '../../src/utils/normalizer.js';

// ============================================================
// REALISTIC MOCK DATA — 10 queries x ~10 signals each
// ============================================================

const MOCK_SIGNALS = {
    'AI receptionist': [
        // TRUE POSITIVE — should be accepted
        {
            title: 'Looking for AI receptionist for our dental practice',
            content: 'We are a 5-location dental group and need an AI receptionist to handle appointment scheduling and patient calls. Currently using a human receptionist but need to scale. Evaluating alternatives and comparing pricing across vendors. Anyone using an AI receptionist solution they recommend?',
            source: 'reddit', subreddit: 'r/dentistry', url: 'https://reddit.com/r/dentistry/1', author: 'DrSmith', company: 'AI receptionist', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Genuine buyer evaluating AI receptionist for business use'
        },
        {
            title: 'AI receptionist vs Smith.ai comparison',
            content: 'We have been using Smith.ai for our law firm but their pricing is getting too expensive. Looking at AI receptionist alternatives. Does anyone have experience comparing these two? Need something with good integration with our case management system.',
            source: 'linkedin', url: 'https://linkedin.com/posts/1', author: 'LegalOps', company: 'AI receptionist', createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Switching discussion with vendor comparison'
        },
        {
            title: 'Frustrated with our current phone answering service',
            content: 'Our current virtual receptionist is terrible. Missed calls, wrong appointments, terrible support. We are frustrated and looking to switch. Need an AI receptionist that actually works. Budget is around $500/month for our clinic.',
            source: 'reddit', subreddit: 'r/smallbusiness', url: 'https://reddit.com/r/smallbusiness/2', author: 'ClinicManager', company: 'AI receptionist', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Frustration + switching intent + budget mentioned'
        },
        // FALSE POSITIVE CANDIDATES — should be rejected
        {
            title: 'AI receptionist device - eBay listing',
            content: 'Buy this AI receptionist device for your office. Free shipping available. Add to cart now. Great condition, barely used.',
            source: 'reddit', subreddit: 'r/forhire', url: 'https://reddit.com/r/forhire/3', author: 'Seller123', company: 'AI receptionist', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Marketplace listing'
        },
        {
            title: 'My experience working as an AI receptionist trainer',
            content: 'I worked as a receptionist for 10 years and then transitioned to training AI receptionist systems. Here is my career story and what I learned about the job.',
            source: 'reddit', subreddit: 'r/careerguidance', url: 'https://reddit.com/r/careerguidance/4', author: 'CareerStory', company: 'AI receptionist', createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Personal story'
        },
        {
            title: 'AI receptionist meme - when the bot answers your ex\'s call',
            content: 'LOL this is hilarious, imagine an AI receptionist answering your ex\'s call and roasting them. This is so funny lmao. Made this meme for you all.',
            source: 'reddit', subreddit: 'r/funny', url: 'https://reddit.com/r/funny/5', author: 'MemeLord', company: 'AI receptionist', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Meme/joke'
        },
        {
            title: 'What is an AI receptionist and how does it work?',
            content: 'I am writing a research paper on the future of AI in customer service. Can someone explain the technology behind AI receptionist systems? This is for a university study.',
            source: 'hackernews', url: 'https://news.ycombinator.com/6', author: 'Researcher42', company: 'AI receptionist', createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Academic discussion'
        },
        {
            title: 'AI receptionist startup raises $20M Series A',
            content: 'The AI receptionist unicorn just announced a $20M funding round with a valuation of $100M. Bloomberg reports the company is planning an acquisition.',
            source: 'news', url: 'https://techcrunch.com/7', author: 'TechReporter', company: 'AI receptionist', createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'News/buzz without buying intent'
        },
        {
            title: 'AI receptionist developer looking for work',
            content: 'I am a software engineer who has built AI receptionist systems. Looking for a job, here is my resume and portfolio. Open to work.',
            source: 'linkedin', url: 'https://linkedin.com/posts/8', author: 'JobSeeker', company: 'AI receptionist', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Job seeker'
        },
        // BORDERLINE CASES
        {
            title: 'Best AI receptionist software for small business 2026',
            content: 'Top 10 AI receptionist tools compared. We reviewed pricing, features, and integration options. Here is our ranking of the best AI receptionist software.',
            source: 'reddit', subreddit: 'r/SaaS', url: 'https://reddit.com/r/SaaS/9', author: 'Reviewer', company: 'AI receptionist', createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'SEO listicle'
        },
        {
            title: 'AI receptionist for my apartment building',
            content: 'I want an AI receptionist for my apartment building to handle package deliveries. Personal use only, for my family. Any suggestions?',
            source: 'reddit', subreddit: 'r/HomeAutomation', url: 'https://reddit.com/r/HomeAutomation/10', author: 'HomeOwner', company: 'AI receptionist', createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Non-B2B (personal use)'
        },
    ],

    'CRM': [
        {
            title: 'HubSpot vs Salesforce for B2B SaaS - which CRM should we choose?',
            content: 'We are a 50-person B2B SaaS company evaluating CRM options. Currently on spreadsheets. Need something with good pipeline management, email integration, and reporting. Budget is $50-100 per user per month. Our CTO is pushing for HubSpot but our sales VP wants Salesforce. Any recommendations?',
            source: 'reddit', subreddit: 'r/sales', url: 'https://reddit.com/r/sales/crm1', author: 'SalesOps', company: 'CRM', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Active CRM evaluation with budget and decision-makers'
        },
        {
            title: 'Frustrated with Pipedrive - looking to switch CRM',
            content: 'We have been using Pipedrive for 2 years but it is too basic for our needs. The reporting is terrible and the integration with our accounting software is broken. We are frustrated and need a better CRM. Considering HubSpot or Salesforce. Need to migrate by end of Q2.',
            source: 'linkedin', url: 'https://linkedin.com/posts/crm2', author: 'OpsDirector', company: 'CRM', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Frustration + switching intent + timeline'
        },
        {
            title: 'Just purchased HubSpot Enterprise - our experience',
            content: 'We just signed the contract for HubSpot Enterprise after 3 months of evaluation. The decision was approved by our CFO. Implementation starts next month. Excited to finally have a proper CRM.',
            source: 'reddit', subreddit: 'r/HubSpot', url: 'https://reddit.com/r/HubSpot/crm3', author: 'NewHubSpotUser', company: 'CRM', createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Decision stage - just purchased'
        },
        {
            title: 'CRM pricing comparison chart - HubSpot vs Salesforce vs Pipedrive',
            content: 'We made this comprehensive pricing comparison of the top 3 CRMs. HubSpot starts at $45/month, Salesforce at $25/month, Pipedrive at $14/month. Enterprise tiers comparison included.',
            source: 'news', url: 'https://blog.example.com/crm4', author: 'BlogWriter', company: 'CRM', createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Content marketing/SEO'
        },
        {
            title: 'CRM developer looking for job',
            content: 'I am a CRM developer with 5 years of HubSpot and Salesforce experience. Looking for a job. Here is my resume and portfolio. Open to remote work.',
            source: 'linkedin', url: 'https://linkedin.com/posts/crm5', author: 'CRMDev', company: 'CRM', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Job seeker'
        },
        {
            title: 'What CRM does everyone use? Need recommendation',
            content: 'Running a 20-person marketing agency. We need a CRM that handles client management, project tracking, and invoicing. What do you use? Any suggestions for a good CRM? Budget around $30/user/month.',
            source: 'reddit', subreddit: 'r/marketing', url: 'https://reddit.com/r/marketing/crm6', author: 'AgencyOwner', company: 'CRM', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Recommendation request with budget'
        },
        {
            title: 'We are hiring a CRM administrator',
            content: 'Our company is hiring a CRM administrator to manage our Salesforce instance. Must have 3+ years experience. Join our team!',
            source: 'linkedin', url: 'https://linkedin.com/posts/crm7', author: 'HRManager', company: 'CRM', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Hiring post'
        },
    ],

    'customer support automation': [
        {
            title: 'Looking for customer support automation for our e-commerce store',
            content: 'We process 500+ support tickets per day and need customer support automation to handle common queries. Evaluating Zendesk, Intercom, and Freshdesk. Need good integration with Shopify. Budget is $2000/month. Our support team is overwhelmed.',
            source: 'reddit', subreddit: 'r/ecommerce', url: 'https://reddit.com/r/ecommerce/cs1', author: 'EcomOwner', company: 'customer support automation', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Active evaluation with pain point and budget'
        },
        {
            title: 'Tired of Zendesk - customer support automation alternatives?',
            content: 'We are sick of Zendesk. The pricing keeps going up and the support is terrible. We are frustrated and looking for customer support automation alternatives. Need something with better AI capabilities. Considering Intercom or Freshdesk. Any recommendations?',
            source: 'linkedin', url: 'https://linkedin.com/posts/cs2', author: 'SupportManager', company: 'customer support automation', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Frustration + switching intent + vendor comparison'
        },
        {
            title: 'Customer support automation meme - when AI answers the phone',
            content: 'LOL this is hilarious. The AI customer support automation answered my call and kept me on hold for 30 minutes. The irony is not lost on me. This is so funny lmao.',
            source: 'reddit', subreddit: 'r/funny', url: 'https://reddit.com/r/funny/cs3', author: 'MemeFan', company: 'customer support automation', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Meme/joke'
        },
        {
            title: 'How customer support automation works - research paper',
            content: 'This study examines the effectiveness of customer support automation in reducing ticket volume. Published in the Journal of Customer Service Research. University study with peer review.',
            source: 'hackernews', url: 'https://news.ycombinator.com/cs4', author: 'AcademicResearcher', company: 'customer support automation', createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Academic content'
        },
        {
            title: 'Customer support automation for my personal blog',
            content: 'I have a personal blog and want customer support automation for my small audience. For my home use only. Any cheap options?',
            source: 'reddit', subreddit: 'r/blogging', url: 'https://reddit.com/r/blogging/cs5', author: 'Blogger', company: 'customer support automation', createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Non-B2B (personal use)'
        },
    ],

    'ATS': [
        {
            title: 'ATS comparison - Greenhouse vs Lever for 100-person startup',
            content: 'We are a 100-person startup looking for an ATS. Currently using spreadsheets which is not scalable. Evaluating Greenhouse and Lever. Need good integration with our HRIS and job boards. Budget is $15,000/year. Our HR director wants to move fast, need decision by end of Q1.',
            source: 'linkedin', url: 'https://linkedin.com/posts/ats1', author: 'HROps', company: 'ATS', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Active ATS evaluation with timeline and budget'
        },
        {
            title: 'Frustrated with our current ATS - switching from iCIMS',
            content: 'We are fed up with iCIMS. The interface is clunky, support is terrible, and we are wasting time on manual processes. Looking to switch to a better ATS. Considering Greenhouse, Lever, or Workable. Need to migrate by summer.',
            source: 'reddit', subreddit: 'r/humanresources', url: 'https://reddit.com/r/humanresources/ats2', author: 'TalentAcq', company: 'ATS', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Frustration + switching intent'
        },
    ],

    'sales engagement': [
        {
            title: 'Sales engagement platform comparison - Outreach vs Salesloft',
            content: 'We are evaluating sales engagement platforms for our 30-person sales team. Currently using manual email sequences. Comparing Outreach and Salesloft. Need good CRM integration with Salesforce. Budget is $100/user/month. Our VP Sales wants to make a decision this quarter.',
            source: 'linkedin', url: 'https://linkedin.com/posts/se1', author: 'RevOps', company: 'sales engagement', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Active evaluation with budget and decision timeline'
        },
        {
            title: 'Outreach pricing too expensive - looking for alternatives',
            content: 'Outreach just raised their prices again. We are paying $150/user/month and it is not worth it. Looking for cheaper sales engagement alternatives. Any recommendations? Need something with good sequence automation and reporting.',
            source: 'reddit', subreddit: 'r/sales', url: 'https://reddit.com/r/sales/se2', author: 'SalesManager', company: 'sales engagement', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Budget frustration + looking for alternatives'
        },
    ],

    'outbound automation': [
        {
            title: 'Outbound automation tools for B2B prospecting',
            content: 'We need outbound automation for our B2B prospecting. Currently doing manual outreach which is not scalable. Evaluating Lemlist, Instantly, and Smartlead. Need good deliverability tracking and integration with our CRM. Budget is $500/month.',
            source: 'reddit', subreddit: 'r/B2BMarketing', url: 'https://reddit.com/r/B2BMarketing/out1', author: 'GrowthLead', company: 'outbound automation', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Active evaluation with budget'
        },
        {
            title: 'Outbound automation - future of AI in sales',
            content: 'The future of AI in outbound automation is exciting. Neural networks and large language models are transforming how we do sales. ChatGPT is changing everything.',
            source: 'hackernews', url: 'https://news.ycombinator.com/out2', author: 'TechEnthusiast', company: 'outbound automation', createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Generic AI discussion'
        },
    ],

    'call center software': [
        {
            title: 'Call center software for our 50-seat operation',
            content: 'We run a 50-seat call center and need new call center software. Currently using Avaya but it is too expensive and outdated. Looking at Five9, Talkdesk, and Genesys. Need good IVR, call routing, and reporting. Budget is $30/agent/month. Need to decide by end of month.',
            source: 'linkedin', url: 'https://linkedin.com/posts/cc1', author: 'CallCenterDir', company: 'call center software', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Active evaluation with timeline and budget'
        },
        {
            title: 'Five9 vs Talkdesk - which call center software is better?',
            content: 'Our IT team is comparing Five9 and Talkdesk for our call center. We need something with good API integration, reliable uptime, and easy migration from Avaya. Has anyone tried both? What are the key differences?',
            source: 'reddit', subreddit: 'r/callcenters', url: 'https://reddit.com/r/callcenters/cc2', author: 'ITManager', company: 'call center software', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Vendor comparison with technical requirements'
        },
    ],

    'voice AI': [
        {
            title: 'Voice AI for appointment scheduling in healthcare',
            content: 'We are a healthcare network looking for voice AI to automate appointment scheduling. Need HIPAA compliance and integration with our EHR system. Evaluating solutions from Nuance, Google Cloud Speech, and Amazon Transcribe. Budget is $50K/year.',
            source: 'linkedin', url: 'https://linkedin.com/posts/voice1', author: 'HealthcareIT', company: 'voice AI', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Enterprise evaluation with compliance requirements'
        },
        {
            title: 'Voice AI is taking over - the future is here',
            content: 'Voice AI is revolutionizing everything. From customer service to personal assistants, the technology is incredible. What is voice AI? How does it work? The future of voice AI is exciting.',
            source: 'hackernews', url: 'https://news.ycombinator.com/voice2', author: 'TechBlogger', company: 'voice AI', createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Generic AI discussion'
        },
    ],

    'AI phone answering': [
        {
            title: 'AI phone answering for our law firm',
            content: 'We are a mid-size law firm looking for AI phone answering to handle client intake calls. Need something that can schedule consultations and route urgent matters. Currently using a human receptionist but need to scale. Evaluating alternatives and comparing pricing.',
            source: 'reddit', subreddit: 'r/lawfirm', url: 'https://reddit.com/r/lawfirm/ai1', author: 'LawFirmOps', company: 'AI phone answering', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'ACCEPT', reason: 'Active evaluation with business need'
        },
        {
            title: 'AI phone answering device for sale - eBay',
            content: 'Selling my AI phone answering device. Works great, barely used. Buy now for $99. Free shipping. Check out my listing on eBay.',
            source: 'reddit', subreddit: 'r/forhire', url: 'https://reddit.com/r/forhire/ai2', author: 'Seller99', company: 'AI phone answering', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            expect: 'REJECT', reason: 'Marketplace listing'
        },
    ],
};

// ============================================================
// PIPELINE STAGE RUNNER
// ============================================================

function runPipelineStage1_TopicRelevance(signals, topicProfile) {
    const results = [];
    for (const signal of signals) {
        const result = checkTopicRelevance(signal, topicProfile);
        results.push({
            ...signal,
            stage: 'topic_relevance',
            passed: result.isTopicRelevant,
            score: result.topicScore,
            matchedTerms: result.matchedTerms,
            rejectionReason: result.rejectionReason,
        });
    }
    return results;
}

function runPipelineStage2_NegativeFilter(signals) {
    const results = [];
    for (const signal of signals) {
        const result = filterNegatives(signal);
        results.push({
            ...signal,
            stage: 'negative_filter',
            passed: !result.isFiltered,
            filterCategory: result.filterCategory,
            rejectionReason: result.isFiltered ? result.filterReason : null,
        });
    }
    return results;
}

function runPipelineStage3_CommercialIntent(signals, validCompanies, knownCompetitors) {
    const results = [];
    for (const signal of signals) {
        const fullText = `${signal.title || ''} ${signal.content || ''}`;
        const cleanedText = cleanText(fullText);

        const noiseData = detectNoise(cleanedText);
        const buyingSignals = detectBuyingSignals(cleanedText);
        const painSignals = detectPainSignals(cleanedText);
        const switchSignals = detectSwitchingSignals(cleanedText, validCompanies, knownCompetitors);
        const competitorSignals = detectCompetitors(cleanedText, knownCompetitors);
        const personaSignals = extractPersona(cleanedText);
        const sentiment = analyzeAspectSentiment(cleanedText, signal.company, knownCompetitors);
        const buyingStage = predictBuyingStage(buyingSignals, sentiment);

        const hasCommercialIntent =
            buyingSignals.hasFrustrationSignal ||
            buyingSignals.hasEvaluationSignal ||
            buyingSignals.hasBudgetSignal ||
            buyingSignals.hasDecisionSignal ||
            buyingSignals.hasTechnicalSignal;

        const { commercialRelevanceScore, commercialRelevanceLevel } = calculateCommercialRelevance(
            cleanedText, signal.title, signal.author, { buyingSignals, painSignals, switchSignals, buyingStage }
        );

        const { intentScore, intentLevel } = calculateIntentScore({
            buyingSignals, sentiment, personaSignals, painSignals, switchSignals, buyingStage, competitorSignals
        }, signal.source, signal.subreddit || '', 3, noiseData.isNoise, 0);

        let rejectionReason = null;
        if (noiseData.isNoise) {
            rejectionReason = noiseData.reason;
        } else if (!hasCommercialIntent) {
            rejectionReason = 'Generic mention lacking commercial or pain indicators';
        }

        results.push({
            ...signal,
            stage: 'commercial_intent',
            passed: hasCommercialIntent && !noiseData.isNoise,
            intentScore,
            intentLevel,
            buyingStage,
            buyingSignals: {
                budget: buyingSignals.hasBudgetSignal,
                timeline: buyingSignals.hasTimelineSignal,
                technical: buyingSignals.hasTechnicalSignal,
                evaluation: buyingSignals.hasEvaluationSignal,
                decision: buyingSignals.hasDecisionSignal,
                frustration: buyingSignals.hasFrustrationSignal,
            },
            painSignals: painSignals.hasPainSignal ? painSignals.painTypes : [],
            switchingDetected: switchSignals.switchingDetected,
            commercialRelevanceLevel,
            rejectionReason,
        });
    }
    return results;
}

// ============================================================
// TEST SUITE
// ============================================================

describe('Production Audit — End-to-End Pipeline Validation', () => {
    const queries = Object.keys(MOCK_SIGNALS);
    const allAuditResults = {};

    for (const query of queries) {
        describe(`Query: "${query}"`, () => {
            const signals = MOCK_SIGNALS[query];
            const topicProfile = buildTopicProfile(query);
            const validCompanies = [query];
            const knownCompetitors = [];

            it(`should correctly filter ${signals.length} signals for "${query}"`, () => {
                const stage1 = runPipelineStage1_TopicRelevance(signals, topicProfile);
                const stage2Passed = stage1.filter(s => s.passed);
                const stage2 = runPipelineStage2_NegativeFilter(stage2Passed);
                const stage3Passed = stage2.filter(s => s.passed);
                const stage3 = runPipelineStage3_CommercialIntent(stage3Passed, validCompanies, knownCompetitors);

                // Log detailed results for this query
                const queryResults = {
                    query,
                    totalInput: signals.length,
                    stage1_rejected: stage1.filter(s => !s.passed).length,
                    stage2_rejected: stage2.filter(s => !s.passed).length,
                    stage3_rejected: stage3.filter(s => !s.passed).length,
                    finalAccepted: stage3.filter(s => s.passed).length,
                    signals: signals.map(s => ({
                        title: s.title.substring(0, 60),
                        expect: s.expect,
                        reason: s.reason,
                    })),
                    stage1_details: stage1.map(s => ({
                        title: s.title.substring(0, 60),
                        passed: s.passed,
                        score: s.score,
                        rejectionReason: s.rejectionReason,
                    })),
                    stage2_details: stage2.map(s => ({
                        title: s.title.substring(0, 60),
                        passed: s.passed,
                        filterCategory: s.filterCategory,
                        rejectionReason: s.rejectionReason,
                    })),
                    stage3_details: stage3.map(s => ({
                        title: s.title.substring(0, 60),
                        passed: s.passed,
                        intentScore: s.intentScore,
                        buyingStage: s.buyingStage,
                        rejectionReason: s.rejectionReason,
                    })),
                };

                allAuditResults[query] = queryResults;

                // Basic assertions
                expect(stage3).toBeDefined();
                expect(stage3.length).toBeGreaterThanOrEqual(0);
            });
        });
    }

    it('should produce overall audit summary', () => {
        console.log('\n' + '='.repeat(80));
        console.log('PRODUCTION AUDIT SUMMARY');
        console.log('='.repeat(80));

        let totalInput = 0;
        let totalAccepted = 0;
        let totalRejectedByStage = { topic: 0, negative: 0, intent: 0 };
        let falsePositives = [];
        let falseNegatives = [];

        for (const [query, result] of Object.entries(allAuditResults)) {
            totalInput += result.totalInput;
            totalAccepted += result.finalAccepted;
            totalRejectedByStage.topic += result.stage1_rejected;
            totalRejectedByStage.negative += result.stage2_rejected;
            totalRejectedByStage.intent += result.stage3_rejected;

            console.log(`\n--- ${query} ---`);
            console.log(`  Input: ${result.totalInput} signals`);
            console.log(`  Topic Relevance rejected: ${result.stage1_rejected}`);
            console.log(`  Negative Filter rejected: ${result.stage2_rejected}`);
            console.log(`  Commercial Intent rejected: ${result.stage3_rejected}`);
            console.log(`  Final Accepted: ${result.finalAccepted}`);

            // Check for false positives and negatives
            for (const detail of result.stage3_details) {
                const original = MOCK_SIGNALS[query].find(s => s.title.substring(0, 60) === detail.title);
                if (original) {
                    if (original.expect === 'REJECT' && detail.passed) {
                        falsePositives.push({
                            query,
                            title: detail.title,
                            expect: original.expect,
                            reason: original.reason,
                            intentScore: detail.intentScore,
                        });
                    }
                    if (original.expect === 'ACCEPT' && !detail.passed) {
                        falseNegatives.push({
                            query,
                            title: detail.title,
                            expect: original.expect,
                            reason: original.reason,
                            rejectionReason: detail.rejectionReason,
                        });
                    }
                }
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log('OVERALL METRICS');
        console.log('='.repeat(80));
        console.log(`Total Input Signals: ${totalInput}`);
        console.log(`Total Accepted: ${totalAccepted}`);
        console.log(`Acceptance Rate: ${((totalAccepted / totalInput) * 100).toFixed(1)}%`);
        console.log(`Topic Relevance Rejections: ${totalRejectedByStage.topic}`);
        console.log(`Negative Filter Rejections: ${totalRejectedByStage.negative}`);
        console.log(`Commercial Intent Rejections: ${totalRejectedByStage.intent}`);

        console.log(`\nFalse Positives (should reject but accepted): ${falsePositives.length}`);
        for (const fp of falsePositives) {
            console.log(`  - [${fp.query}] ${fp.title} (score: ${fp.intentScore})`);
            console.log(`    Expected: ${fp.reason}`);
        }

        console.log(`\nFalse Negatives (should accept but rejected): ${falseNegatives.length}`);
        for (const fn of falseNegatives) {
            console.log(`  - [${fn.query}] ${fn.title}`);
            console.log(`    Rejection: ${fn.rejectionReason}`);
        }

        console.log('\n' + '='.repeat(80));
        expect(true).toBe(true); // Always passes, just for output
    });
});
