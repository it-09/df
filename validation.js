import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const tests = [
    {
        name: 'SaaS CRM',
        companies: ["HubSpot", "Apollo", "Salesforce"]
    },
    {
        name: 'Developer Tools',
        companies: ["Vercel", "PostHog", "Supabase"]
    },
    {
        name: 'Sales/Marketing',
        companies: ["Clay", "Lemlist", "Outreach"]
    }
];

function runValidation() {
    console.log('Starting Product Validation Framework...');
    
    for (const test of tests) {
        console.log(`\n====================================================`);
        console.log(`Running Test: ${test.name}`);
        console.log(`Companies: ${test.companies.join(', ')}`);
        
        // Prepare input
        const input = {
            companies: test.companies,
            enableG2: true,
            enableGithub: true,
            enableHackernews: true,
            enableLinkedin: true,
            enableNews: false,
            enableReddit: true,
            maxRequestsPerCrawl: 5
        };
        
        fs.writeFileSync(
            path.join(process.cwd(), 'storage', 'key_value_stores', 'default', 'INPUT.json'),
            JSON.stringify(input, null, 2)
        );

        // Clear previous dataset
        const datasetPath = path.join(process.cwd(), 'storage', 'datasets', 'default');
        if (fs.existsSync(datasetPath)) {
            fs.rmSync(datasetPath, { recursive: true, force: true });
        }
        
        // Run actor silently
        try {
            execSync('npm run start', { stdio: 'ignore', env: { ...process.env, DEBUG_MODE: 'false' } });
        } catch (e) {
            console.error(`Error running actor: ${e.message}`);
        }
        
        // Analyze dataset
        let signals = [];
        if (fs.existsSync(datasetPath)) {
            const files = fs.readdirSync(datasetPath).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const data = JSON.parse(fs.readFileSync(path.join(datasetPath, file), 'utf8'));
                if (data.source && data.company) {
                    signals.push(data);
                }
            }
        }
        
        const total = signals.length;
        if (total === 0) {
            console.log(`\n=== VALIDATION REPORT ===\nCategory: ${test.name}\n\nNo signals collected.`);
            continue;
        }

        // Metrics calculation
        let totalIntentScore = 0;
        let fallbackCount = 0;
        const sourceCounts = {};
        
        for (const signal of signals) {
            totalIntentScore += (signal.intentScore || 0);
            sourceCounts[signal.source] = (sourceCounts[signal.source] || 0) + 1;
            
            // Check fallback (from crmReady logic, where reason is mapped)
            if (signal.crmReady?.leadReason === 'general buying signals detected') {
                fallbackCount++;
            }
        }
        
        const avgIntent = totalIntentScore / total;
        const fallbackPct = Math.round((fallbackCount / total) * 100);
        
        // Scores
        const signalQuality = Math.min(10, (avgIntent / 10)).toFixed(1);
        const noiseLevel = Math.max(0, 10 - (avgIntent / 10)).toFixed(1);
        const commercialUsefulness = Math.min(10, ((100 - fallbackPct) / 10)).toFixed(1);
        
        console.log(`\n=== VALIDATION REPORT ===\n`);
        console.log(`Category: ${test.name}\n`);
        console.log(`Signal Quality: ${signalQuality}/10`);
        console.log(`Noise Level: ${noiseLevel}/10`);
        console.log(`Commercial Usefulness: ${commercialUsefulness}/10`);
        console.log(`Fallback Explanations: ${fallbackPct}%\n`);
        
        console.log(`Source Mix:`);
        for (const [src, count] of Object.entries(sourceCounts)) {
            const pct = Math.round((count / total) * 100);
            console.log(`${src}: ${pct}%`);
        }
    }
}

runValidation();
