/**
 * Enhanced Question Scraper for GateOverflow
 * Fetches full question, options, and correct answer
 * 
 * Run: node scripts/scrape_full_questions.js <topic> [limit]
 * Example: node scripts/scrape_full_questions.js programming 10
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Get arguments
const topic = process.argv[2];
const limit = parseInt(process.argv[3]) || Infinity; // No limit by default - process all questions

if (!topic) {
    console.log('Usage: node scrape_full_questions.js <topic> [limit]');
    console.log('Example: node scrape_full_questions.js programming 10');
    console.log('\nAvailable topics:');
    try {
        const topicMap = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/topic_map.json'), 'utf8'));
        Object.keys(topicMap).forEach(t => console.log(`  - ${t}`));
    } catch (e) {}
    process.exit(1);
}

const inputFile = path.join(__dirname, `../data/pyqs/${topic}.json`);
const outputFile = path.join(__dirname, `../data/pyqs/${topic}_enhanced.json`);

if (!fs.existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
let allQuestions = data.questions || [];
allQuestions = allQuestions.slice(0, limit);

// Load existing enhanced data to resume from where we left off
let existingEnhanced = [];
let alreadyScrapedIds = new Set();
if (fs.existsSync(outputFile)) {
    try {
        const existingData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        existingEnhanced = existingData.questions || [];
        // Build set of already scraped question IDs/links
        existingEnhanced.forEach(q => {
            if (q.id) alreadyScrapedIds.add(q.id);
            if (q.link) alreadyScrapedIds.add(q.link);
        });
        console.log(`Found ${existingEnhanced.length} already scraped questions, resuming...`);
    } catch (e) {
        console.log('Could not parse existing enhanced file, starting fresh');
    }
}

// Filter out already scraped questions
const questions = allQuestions.filter(q => !alreadyScrapedIds.has(q.id) && !alreadyScrapedIds.has(q.link));

console.log(`Processing ${questions.length} new questions from ${topic} (${allQuestions.length} total, ${existingEnhanced.length} already done)...`);

if (questions.length === 0) {
    console.log('All questions already scraped!');
    process.exit(0);
}

// Fetch URL with timeout and redirect handling
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        // Fix URL - remove /../ patterns
        url = url.replace(/\/\.\.\//g, '/');
        url = url.replace(/^\.\.\//g, '');
        
        if (!url.startsWith('http')) {
            url = 'https://gateoverflow.in/' + url.replace(/^\/+/, '');
        }
        
        const protocol = url.startsWith('https') ? https : http;
        
        const req = protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        }, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirectUrl = res.headers.location;
                // Fix relative redirects
                redirectUrl = redirectUrl.replace(/^\.\.\//g, '');
                redirectUrl = redirectUrl.replace(/\/\.\.\//g, '/');
                if (!redirectUrl.startsWith('http')) {
                    redirectUrl = 'https://gateoverflow.in/' + redirectUrl.replace(/^\/+/, '');
                }
                return fetchUrl(redirectUrl).then(resolve).catch(reject);
            }
            
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        
        req.on('error', reject);
        req.setTimeout(20000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

// Parse HTML to extract question details
function parseQuestionPage(html, url) {
    const result = {
        questionHtml: '',
        questionText: '',
        codeBlocks: [],
        options: [],
        correctAnswer: null,
        explanation: '',
        images: [],
        isNAT: false,
        isMSQ: false,
        marks: 1
    };
    
    try {
        // Check question type from tags or content
        result.isNAT = /\bNAT\b|numerical\s*answer/i.test(html);
        result.isMSQ = /\bMSQ\b|multiple\s*select/i.test(html);
        
        // Extract marks
        const marksMatch = html.match(/(\d+)\s*marks?/i);
        if (marksMatch) {
            result.marks = parseInt(marksMatch[1]);
        }
        
        // Extract question content - look for the question post
        let questionContent = '';
        
        // Try different patterns to find the question
        const questionPatterns = [
            /<div[^>]*class="[^"]*qa-q-view-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*post-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*question-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<article[^>]*>([\s\S]*?)<\/article>/i
        ];
        
        for (const pattern of questionPatterns) {
            const match = html.match(pattern);
            if (match && match[1].length > 50) {
                questionContent = match[1];
                break;
            }
        }
        
        // If still no content, try to get the main content area
        if (!questionContent) {
            const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
            if (mainMatch) {
                questionContent = mainMatch[1];
            }
        }
        
        result.questionHtml = questionContent;
        
        // Extract plain text (remove HTML tags)
        result.questionText = questionContent
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Extract code blocks
        const codeMatches = html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi);
        for (const match of codeMatches) {
            const code = match[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .trim();
            if (code.length > 10) {
                result.codeBlocks.push(code);
            }
        }
        
        // Extract images
        const imgMatches = html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi);
        for (const match of imgMatches) {
            const src = match[1];
            if (src && !src.includes('avatar') && !src.includes('icon') && 
                !src.includes('logo') && !src.includes('gravatar')) {
                // Make absolute URL
                let imgUrl = src;
                if (src.startsWith('//')) {
                    imgUrl = 'https:' + src;
                } else if (src.startsWith('/')) {
                    imgUrl = 'https://gateoverflow.in' + src;
                }
                result.images.push(imgUrl);
            }
        }
        
        // Helper to clean option text
        function cleanOptionText(text) {
            return text
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]+>/g, '')  // Remove all HTML tags
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
        
        // Extract MCQ options - try multiple methods
        const opts = {};
        
        // Method 1: Look for ordered list with upper-alpha style (common in GATE)
        const olMatch = (questionContent || html).match(/<ol[^>]*style="[^"]*list-style-type:\s*upper-(?:alpha|latin)[^"]*"[^>]*>([\s\S]*?)<\/ol>/i);
        if (olMatch) {
            const listContent = olMatch[1];
            const liMatches = [...listContent.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
            const labels = ['A', 'B', 'C', 'D'];
            liMatches.forEach((match, index) => {
                if (index < 4) {
                    opts[labels[index]] = cleanOptionText(match[1]);
                }
            });
        }
        
        // Method 2: Look for any ordered list starting at 1 with list items
        if (Object.keys(opts).length < 2) {
            const olMatches = (questionContent || html).match(/<ol[^>]*start="1"[^>]*>([\s\S]*?)<\/ol>/i);
            if (olMatches) {
                const listContent = olMatches[1];
                const liMatches = [...listContent.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
                const labels = ['A', 'B', 'C', 'D'];
                liMatches.forEach((match, index) => {
                    if (index < 4) {
                        opts[labels[index]] = cleanOptionText(match[1]);
                    }
                });
            }
        }
        
        // Method 3: Pattern matching for (A), (B), etc.
        if (Object.keys(opts).length < 2) {
            const optionsText = questionContent || html;
            const optionPatterns = [
                /\(([A-D])\)\s*([^\n\r(]+?)(?=\s*\([A-D]\)|<\/|$)/gi,
                /(?:^|\s)([A-D])\)\s*([^\n\r]+?)(?=\s*[A-D]\)|<\/|$)/gim,
                /(?:^|\s)([A-D])\.\s*([^\n\r]+?)(?=\s*[A-D]\.|<\/|$)/gim
            ];
            
            for (const pattern of optionPatterns) {
                const matches = [...optionsText.matchAll(pattern)];
                if (matches.length >= 2) {
                    for (const match of matches) {
                        const label = match[1].toUpperCase();
                        let text = match[2]
                            .replace(/<[^>]+>/g, '')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&amp;/g, '&')
                            .replace(/\s+/g, ' ')
                            .trim();
                        text = text.replace(/\s*\([A-D]\)\s*$/, '').trim();
                        if (text.length > 0 && text.length < 500) {
                            opts[label] = text;
                        }
                    }
                    if (Object.keys(opts).length >= 2) break;
                }
            }
        }
        
        // Build options array
        if (Object.keys(opts).length >= 2) {
            result.options = ['A', 'B', 'C', 'D'].map(l => ({
                label: l,
                text: opts[l] || ''
            })).filter(o => o.text.length > 0);
        }
        
        // If no options found, check if it's NAT
        if (result.options.length === 0 && !result.isNAT) {
            // Check for NAT indicators
            if (/_+|blank|fill\s*in|numerical|integer|value\s*is/i.test(questionContent)) {
                result.isNAT = true;
            }
        }
        
        // Detect MSQ (Multiple Select Question)
        if (/\bMSQ\b|multiple\s*select|more\s*than\s*one|one\s*or\s*more/i.test(html)) {
            result.isMSQ = true;
        }
        
        // Extract correct answer(s) - GateOverflow formats:
        // Single: <button>D</button>
        // MSQ single button: <button>B;C</button> or <button>B,C</button>
        // MSQ multiple buttons: <button>B</button><button>C</button>
        
        // Try to find answer button(s)
        const buttonMatch = html.match(/Answer:\s*<\/span><button[^>]*>([A-D][;,]?[A-D]?[;,]?[A-D]?[;,]?[A-D]?)<\/button>/i);
        if (buttonMatch) {
            // Parse the answer - could be "D", "B;C", "A,B,C", etc.
            const rawAnswer = buttonMatch[1];
            const answers = rawAnswer.split(/[;,]/).map(a => a.trim().toUpperCase()).filter(a => /^[A-D]$/.test(a));
            if (answers.length > 0) {
                result.correctAnswer = answers.join(','); // Normalize to comma-separated
                if (answers.length > 1) result.isMSQ = true;
            }
        }
        
        // Fallback patterns for single answers
        if (!result.correctAnswer) {
            const answerPatterns = [
                // Answer inside button tag (GateOverflow format)
                /Answer:\s*<\/span><button[^>]*>([A-D])<\/button>/i,
                /Answer:\s*<[^>]*>\s*([A-D])\s*<\//i,
                // Simple "Answer: D" 
                /Answer:\s*([A-D])\b/i,
                // Multiple answers like "B, C" or "B;C" or "B and C"
                /Answer:\s*([A-D])\s*[,;&]\s*([A-D])/i,
                /Answer:\s*([A-D])\s+and\s+([A-D])/i,
                // "The answer is X" in explanation
                /The\s+answer\s+is\s+([A-D])\b/i,
                /answer\s+is\s+([A-D])\./i,
                // Option X is correct
                /option\s+([A-D])\s+is\s+correct/i
            ];
            
            for (const pattern of answerPatterns) {
                const match = html.match(pattern);
                if (match) {
                    if (match[2]) {
                        // Multiple answers captured
                        result.correctAnswer = match[1].toUpperCase() + ',' + match[2].toUpperCase();
                        result.isMSQ = true;
                    } else {
                        result.correctAnswer = match[1].toUpperCase();
                    }
                    break;
                }
            }
        }
        
        // Extract answer section for explanation
        const answerSectionPatterns = [
            // Look for selected/best answer section
            /<div[^>]*class="[^"]*(?:best-answer|selected-answer|qa-a-selected)[^"]*"[^>]*>([\s\S]*?)(?:<div[^>]*class="[^"]*qa-a-item|$)/i,
            // Look for answer with checkmark
            /<div[^>]*class="[^"]*qa-a-item[^"]*"[^>]*>[\s\S]*?(?:selected|best|correct)[\s\S]*?<\/div>/i
        ];
        
        let answerSection = '';
        for (const pattern of answerSectionPatterns) {
            const match = html.match(pattern);
            if (match) {
                answerSection = match[1] || match[0];
                break;
            }
        }
        
        // If still no answer, look for explicit "Answer: X" anywhere
        if (!result.correctAnswer) {
            const fallbackPatterns = [
                /(?:correct\s+)?answer\s*:\s*([A-D])\b/i,
                /\(([A-D])\)\s+is\s+(?:the\s+)?(?:correct|right)\s+answer/i
            ];
            
            for (const pattern of fallbackPatterns) {
                const match = html.match(pattern);
                if (match) {
                    result.correctAnswer = match[1].toUpperCase();
                    break;
                }
            }
        }
        
        // Extract explanation from answer section
        if (answerSection) {
            result.explanation = answerSection
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .substring(0, 1000)
                .trim();
        }
        
        // For NAT questions, try to extract numerical answer
        if (result.isNAT && !result.correctAnswer) {
            const natPatterns = [
                /answer\s*(?:is)?\s*:?\s*([-]?\d+(?:\.\d+)?)/i,
                /(?:^|\s)([-]?\d+(?:\.\d+)?)\s*(?:is\s*)?(?:the\s*)?(?:correct|right)?\s*answer/im
            ];
            
            for (const pattern of natPatterns) {
                const match = answerSection ? answerSection.match(pattern) : html.match(pattern);
                if (match) {
                    result.correctAnswer = match[1];
                    break;
                }
            }
        }
        
    } catch (e) {
        console.error('Parse error:', e.message);
    }
    
    return result;
}

// Process all questions
async function processQuestions() {
    // Start with existing enhanced questions
    const enhancedQuestions = [...existingEnhanced];
    let processed = 0;
    // Count existing stats
    let withOptions = existingEnhanced.filter(q => q.options && q.options.length > 0).length;
    let withAnswers = existingEnhanced.filter(q => q.correctAnswer).length;
    
    for (const question of questions) {
        try {
            console.log(`[${existingEnhanced.length + processed + 1}/${allQuestions.length}] Fetching: ${question.title}`);
            
            const html = await fetchUrl(question.link);
            const parsed = parseQuestionPage(html, question.link);
            
            const enhanced = {
                id: question.id,
                title: question.title,
                link: question.link,
                excerpt: question.excerpt,
                // Enhanced data
                questionText: parsed.questionText || question.excerpt,
                questionHtml: parsed.questionHtml,
                codeBlocks: parsed.codeBlocks,
                images: parsed.images,
                options: parsed.options,
                correctAnswer: parsed.correctAnswer,
                explanation: parsed.explanation,
                isNAT: parsed.isNAT,
                isMSQ: parsed.isMSQ,
                marks: parsed.marks,
                fetchedAt: new Date().toISOString()
            };
            
            enhancedQuestions.push(enhanced);
            
            if (parsed.options.length > 0) withOptions++;
            if (parsed.correctAnswer) withAnswers++;
            
            processed++;
            console.log(`  → Options: ${parsed.options.length}, Answer: ${parsed.correctAnswer || 'Not found'}`);
            
            // Rate limiting - wait between requests
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Save progress every 5 questions
            if (processed % 5 === 0) {
                saveProgress(enhancedQuestions, withOptions, withAnswers);
            }
            
        } catch (e) {
            console.error(`  ✗ Error: ${e.message}`);
            
            // Keep original data
            enhancedQuestions.push({
                ...question,
                options: [],
                correctAnswer: null,
                fetchedAt: new Date().toISOString(),
                error: e.message
            });
            processed++;
        }
    }
    
    // Final save
    saveProgress(enhancedQuestions, withOptions, withAnswers);
    
    const totalProcessed = enhancedQuestions.length;
    console.log('\n========== SUMMARY ==========');
    console.log(`Total in file: ${totalProcessed}`);
    console.log(`New questions scraped: ${processed}`);
    console.log(`Previously scraped: ${existingEnhanced.length}`);
    console.log(`With options: ${withOptions} (${Math.round(withOptions/totalProcessed*100)}%)`);
    console.log(`With correct answer: ${withAnswers} (${Math.round(withAnswers/totalProcessed*100)}%)`);
    console.log(`Output: ${outputFile}`);
}

function saveProgress(questions, withOptions, withAnswers) {
    const outputData = {
        tag: data.tag,
        fetchedAt: new Date().toISOString(),
        stats: {
            total: questions.length,
            withOptions,
            withAnswers
        },
        questions
    };
    
    fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
    console.log(`  [Saved progress: ${questions.length} questions]`);
}

// Run
processQuestions().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
