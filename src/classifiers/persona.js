// Persona extraction module

// Job title patterns (regex)
const JOB_TITLE_PATTERNS = [
    // C-suite
    { regex: /\b(ceo|chief executive officer)\b/gi, title: 'CEO', seniority: 'c-suite', department: 'executive' },
    { regex: /\b(cto|chief technology officer)\b/gi, title: 'CTO', seniority: 'c-suite', department: 'engineering' },
    { regex: /\b(cfo|chief financial officer)\b/gi, title: 'CFO', seniority: 'c-suite', department: 'finance' },
    { regex: /\b(coo|chief operating officer)\b/gi, title: 'COO', seniority: 'c-suite', department: 'operations' },
    { regex: /\b(cmo|chief marketing officer)\b/gi, title: 'CMO', seniority: 'c-suite', department: 'marketing' },
    { regex: /\b(ciso|chief information security officer)\b/gi, title: 'CISO', seniority: 'c-suite', department: 'security' },

    // VP level
    { regex: /\b(vp|vice president).*(engineering|tech|development)\b/gi, title: 'VP Engineering', seniority: 'vp', department: 'engineering' },
    { regex: /\b(vp|vice president).*(sales|revenue)\b/gi, title: 'VP Sales', seniority: 'vp', department: 'sales' },
    { regex: /\b(vp|vice president).*(product)\b/gi, title: 'VP Product', seniority: 'vp', department: 'product' },
    { regex: /\b(vp|vice president).*(finance)\b/gi, title: 'VP Finance', seniority: 'vp', department: 'finance' },
    { regex: /\b(vp|vice president).*(operations)\b/gi, title: 'VP Operations', seniority: 'vp', department: 'operations' },

    // Director level
    { regex: /\b(director|head).*(engineering|tech|development)\b/gi, title: 'Director of Engineering', seniority: 'director', department: 'engineering' },
    { regex: /\b(director|head).*(product)\b/gi, title: 'Director of Product', seniority: 'director', department: 'product' },
    { regex: /\b(director|head).*(sales)\b/gi, title: 'Director of Sales', seniority: 'director', department: 'sales' },
    { regex: /\b(director|head).*(operations)\b/gi, title: 'Director of Operations', seniority: 'director', department: 'operations' },

    // Manager level
    { regex: /\b(engineering manager|em)\b/gi, title: 'Engineering Manager', seniority: 'manager', department: 'engineering' },
    { regex: /\b(product manager|pm)\b/gi, title: 'Product Manager', seniority: 'manager', department: 'product' },
    { regex: /\b(sales manager)\b/gi, title: 'Sales Manager', seniority: 'manager', department: 'sales' },
    { regex: /\b(marketing manager)\b/gi, title: 'Marketing Manager', seniority: 'manager', department: 'marketing' },

    // IC roles
    { regex: /\b(software engineer|developer|swe)\b/gi, title: 'Software Engineer', seniority: 'ic', department: 'engineering' },
    { regex: /\b(senior software engineer|senior developer|senior swe)\b/gi, title: 'Senior Software Engineer', seniority: 'ic', department: 'engineering' },
    { regex: /\b(data scientist)\b/gi, title: 'Data Scientist', seniority: 'ic', department: 'engineering' },
    { regex: /\b(devops engineer|sre|site reliability)\b/gi, title: 'DevOps Engineer', seniority: 'ic', department: 'engineering' },
    { regex: /\b(security engineer)\b/gi, title: 'Security Engineer', seniority: 'ic', department: 'security' },
    { regex: /\b(sales development|sdr|bdr)\b/gi, title: 'SDR', seniority: 'ic', department: 'sales' },
];

/**
 * Extract persona signals from text
 * @param {string} text - Text to analyze
 * @returns {Object} - Extracted persona information
 */
export function extractPersona(text) {
    if (!text) {
        return {
            jobTitles: [],
            departments: [],
            seniorityLevels: [],
            confidence: 0
        };
    }

    const jobTitles = [];
    const departments = new Set();
    const seniorityLevels = new Set();

    for (const pattern of JOB_TITLE_PATTERNS) {
        const matches = text.match(pattern.regex);
        if (matches && matches.length > 0) {
            jobTitles.push(pattern.title);
            departments.add(pattern.department);
            seniorityLevels.add(pattern.seniority);
        }
    }

    // Calculate confidence based on explicit mentions
    const confidence = jobTitles.length > 0 ? Math.min(1.0, jobTitles.length * 0.3) : 0;

    return {
        jobTitles: [...new Set(jobTitles)], // Deduplicate
        departments: Array.from(departments),
        seniorityLevels: Array.from(seniorityLevels),
        confidence
    };
}

/**
 * Determine if persona is a decision maker
 * @param {Object} persona - Extracted persona
 * @returns {boolean} - True if likely decision maker
 */
export function isDecisionMaker(persona) {
    if (!persona || !persona.seniorityLevels) return false;

    const decisionMakerLevels = ['c-suite', 'vp', 'director'];
    return persona.seniorityLevels.some(level => decisionMakerLevels.includes(level));
}

/**
 * Score persona influence (0-1)
 * @param {Object} persona - Extracted persona
 * @returns {number} - Influence score
 */
export function scorePersonaInfluence(persona) {
    if (!persona || persona.jobTitles.length === 0) return 0;

    const seniorityScores = {
        'c-suite': 1.0,
        'vp': 0.8,
        'director': 0.6,
        'manager': 0.4,
        'ic': 0.2
    };

    let maxScore = 0;
    for (const level of persona.seniorityLevels) {
        const score = seniorityScores[level] || 0;
        if (score > maxScore) maxScore = score;
    }

    return maxScore;
}