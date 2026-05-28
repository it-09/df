// Lightweight Company Enrichment
// Uses free, unauthenticated APIs to fetch basic company profiles

import axios from 'axios';
import { log } from 'apify';

/**
 * Fetch basic company enrichment data (domain, logo, industry)
 * @param {string} companyName - Name of the company
 * @returns {Promise<Object>} - Enrichment data
 */
export async function enrichCompany(companyName) {
    const enrichment = {
        website: null,
        logo: null,
        industry: null,
        companyType: null
    };

    try {
        // 1. Clearbit Autocomplete API (Free, no auth)
        // Gets exact domain and logo
        const cbUrl = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(companyName)}`;
        const cbResponse = await axios.get(cbUrl, { timeout: 5000 });
        
        if (cbResponse.data && cbResponse.data.length > 0) {
            // Take the best match
            const bestMatch = cbResponse.data[0];
            enrichment.website = bestMatch.domain;
            enrichment.logo = bestMatch.logo;
        }

        // 2. Wikipedia Summary API (Free, no auth)
        // Gets industry/type from the first paragraph
        const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(companyName)}`;
        try {
            const wikiResponse = await axios.get(wikiUrl, { 
                timeout: 5000,
                headers: { 'User-Agent': 'DarkFunnelIntelligenceEngine/1.0 (https://apify.com; contact@apify.com)' }
            });
            if (wikiResponse.data && wikiResponse.data.extract) {
                const extract = wikiResponse.data.extract.toLowerCase();
                
                // Deduce industry/type from summary
                if (extract.includes('software as a service') || extract.includes('saas')) {
                    enrichment.industry = 'SaaS';
                    enrichment.companyType = 'B2B Software';
                } else if (extract.includes('cloud computing')) {
                    enrichment.industry = 'Cloud Computing';
                } else if (extract.includes('financial technology') || extract.includes('fintech')) {
                    enrichment.industry = 'FinTech';
                } else if (extract.includes('artificial intelligence') || extract.includes(' ai ')) {
                    enrichment.industry = 'Artificial Intelligence';
                } else {
                    enrichment.industry = 'Technology (General)';
                }
            }
        } catch (wikiErr) {
            // Wikipedia might 404 for niche companies, which is fine
            log.debug(`Wikipedia enrichment missed for ${companyName}`);
        }

    } catch (err) {
        log.debug(`Company enrichment failed for ${companyName}`, { error: err.message });
    }

    return enrichment;
}
