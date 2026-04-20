/**
 * Script to fetch full question details from GateOverflow
 * Run with: node scripts/fetch_full_questions.js [topic]
 * Example: node scripts/fetch_full_questions.js programming
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Get topic from command line args
const topic = process.argv[2];
if (!topic) {
    console.log('Usage: node fetch_full_questions.js <topic>');
    console.log('Example: node fetch_full_questions.js programming');
    console.log('\nAvailable topics:');
    const topicMap = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/topic_map.json'), 'utf8'));
    Object.keys(topicMap).forEach(t => console.log(`  - ${t}`));
    process.exit(1);
}

const inputFile = path.join(__dirname, `../data/pyqs/${topic}.json`);
const outputFile = path.join(__dirname, `../data/pyqs/${topic}_full.json`);

if (!fs.existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const questions = data.questions || [];

console.log(`Found ${questions.length} questions in ${topic}`);

// Function to fetch a URL
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        // Fix URL if needed
        if (url.includes('/../')) {
            url = url.replace('/../', '/');
        }
        if (!url.startsWith('http')) {
            url = 'https://gateoverflow.in/' + url.replace(/^\/+/, '');
        }
        
        console.log(`Fetching: ${url}`);
        
        const req = protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location).then(resolve).catch(reject);
            }
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        
        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

// Parse question HTML to extract details
function parseQuestionPage(html) {
    const result = {
        questionHtml: '',
        options: [],
        correctAnswer: null,
        explanation: '',
        images: [],
        tags: []
    };
    
    try {
        // Extract question content
        // GateOverflow uses class "question-content" or similar
        let questionMatch = html.match(/<div[^>]*class="[^"]*qa-q-view-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (!questionMatch) {
            questionMatch = html.match(/<div[^>]*class="[^"]*post-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        }
        if (questionMatch) {
            result.questionHtml = questionMatch[1].trim();
        }
        
        // Extract images
        const imgMatches = html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi);
        for (const match of imgMatches) {
            if (match[1] && !match[1].includes('avatar') && !match[1].includes('icon')) {
                result.images.push(match[1]);
            }
        }
        
        // Extract options - look for MCQ options pattern
        // Pattern 1: A. option text
        const optionPatterns = [
            /(?:^|\s)([A-D])[\.\)]\s*([^\n<]+)/gim,
            /<li[^>]*>\s*([A-D])[\.\)]\s*([^<]+)/gim
        ];
        
        for (const pattern of optionPatterns) {
            const matches = [...html.matchAll(pattern)];
            if (matches.length >= 2) {
                result.options = matches.slice(0, 4).map(m => ({
                    label: m[1].toUpperCase(),
                    text: m[2].trim()
                }));
                break;
            }
        }
        
        // Try to find correct answer
        // Look for "correct answer" or green highlighted option
        const correctPatterns = [
            /correct\s*(?:answer|option)\s*(?:is)?\s*:?\s*([A-D])/i,
            /answer\s*:?\s*\(?([A-D])\)?/i,
            /option\s*\(?([A-D])\)?\s*is\s*correct/i,
            /<span[^>]*class="[^"]*correct[^"]*"[^>]*>([A-D])/i,
            /class="[^"]*selected[^"]*"[^>]*>\s*([A-D])/i
        ];
        
        for (const pattern of correctPatterns) {
            const match = html.match(pattern);
            if (match) {
                result.correctAnswer = match[1].toUpperCase();
                break;
            }
        }
        
        // Extract explanation/solution
        const explanationMatch = html.match(/<div[^>]*class="[^"]*(?:answer|solution|explanation)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (explanationMatch) {
            result.explanation = explanationMatch[1].trim();
        }
        
        // Extract tags
        const tagMatches = html.matchAll(/class="[^"]*qa-tag-link[^"]*"[^>]*>([^<]+)</gi);
        for (const match of tagMatches) {
            result.tags.push(match[1].trim());
        }
        
    } catch (e) {
        console.error('Error parsing HTML:', e.message);
    }
    
    return result;
}

// Process questions with rate limiting
async function processQuestions() {
    const enhancedQuestions = [];
    let processed = 0;
    let failed = 0;
    
    for (const question of questions) {
        try {
            const html = await fetchUrl(question.link);
            const parsed = parseQuestionPage(html);
            
            enhancedQuestions.push({
                ...question,
                fullQuestion: parsed.questionHtml || question.excerpt,
                options: parsed.options.length > 0 ? parsed.options : null,
                correctAnswer: parsed.correctAnswer,
                explanation: parsed.explanation,
                images: parsed.images,
                enhancedTags: parsed.tags
            });
            
            processed++;
            console.log(`[${processed}/${questions.length}] Processed: ${question.title}`);
            
            // Rate limiting - wait 1 second between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (e) {
            console.error(`Failed to process: ${question.title} - ${e.message}`);
            failed++;
            
            // Keep original data
            enhancedQuestions.push({
                ...question,
                fullQuestion: question.excerpt,
                options: null,
                correctAnswer: null
            });
        }
        
        // Save progress periodically
        if (processed % 10 === 0) {
            const outputData = {
                tag: data.tag,
                fetchedAt: new Date().toISOString(),
                questions: enhancedQuestions
            };
            fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
            console.log(`Progress saved: ${processed}/${questions.length}`);
        }
    }
    
    // Final save
    const outputData = {
        tag: data.tag,
        fetchedAt: new Date().toISOString(),
        totalQuestions: enhancedQuestions.length,
        withOptions: enhancedQuestions.filter(q => q.options).length,
        withAnswers: enhancedQuestions.filter(q => q.correctAnswer).length,
        questions: enhancedQuestions
    };
    
    fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
    
    console.log('\n=== Summary ===');
    console.log(`Total processed: ${processed}`);
    console.log(`Failed: ${failed}`);
    console.log(`With options extracted: ${enhancedQuestions.filter(q => q.options).length}`);
    console.log(`With correct answer found: ${enhancedQuestions.filter(q => q.correctAnswer).length}`);
    console.log(`Output saved to: ${outputFile}`);
}

processQuestions().catch(console.error);
