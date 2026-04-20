/**
 * Re-fetch Failed Questions
 * Only re-scrapes questions that have:
 * - Empty questionHtml
 * - Error field set
 * - No options extracted (but should have based on excerpt)
 * 
 * Run: node scripts/refetch_failed.js [topic]
 * Example: node scripts/refetch_failed.js algorithms
 * Or run all: node scripts/refetch_failed.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const pyqsDir = path.join(__dirname, '../data/pyqs');

// Get topic from args or process all
const specificTopic = process.argv[2];

// Get all enhanced files
const enhancedFiles = fs.readdirSync(pyqsDir)
    .filter(f => f.endsWith('_enhanced.json'))
    .filter(f => !specificTopic || f === `${specificTopic}_enhanced.json`);

if (enhancedFiles.length === 0) {
    console.log('No enhanced files found' + (specificTopic ? ` for topic: ${specificTopic}` : ''));
    process.exit(1);
}

// Fetch URL with AbortController timeout
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        url = url.replace(/\/\.\.\//g, '/').replace(/^\.\.\//g, '');
        
        if (!url.startsWith('http')) {
            url = 'https://gateoverflow.in/' + url.replace(/^\/+/, '');
        }
        
        const protocol = url.startsWith('https') ? https : http;
        let resolved = false;
        
        // Hard timeout
        const timeoutId = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                if (req) req.destroy();
                reject(new Error('Timeout (10s)'));
            }
        }, 10000);
        
        const req = protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,*/*'
            }
        }, (res) => {
            // Handle redirect
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                clearTimeout(timeoutId);
                if (resolved) return;
                let redirectUrl = res.headers.location;
                if (!redirectUrl.startsWith('http')) {
                    redirectUrl = 'https://gateoverflow.in/' + redirectUrl.replace(/^\/+/, '');
                }
                return fetchUrl(redirectUrl).then(resolve).catch(reject);
            }
            
            if (res.statusCode !== 200) {
                clearTimeout(timeoutId);
                resolved = true;
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                clearTimeout(timeoutId);
                if (!resolved) {
                    resolved = true;
                    resolve(data);
                }
            });
            res.on('error', (e) => {
                clearTimeout(timeoutId);
                if (!resolved) {
                    resolved = true;
                    reject(e);
                }
            });
        });
        
        req.on('error', (e) => {
            clearTimeout(timeoutId);
            if (!resolved) {
                resolved = true;
                reject(e);
            }
        });
    });
}

// Parse question page (same as main scraper)
function parseQuestionPage(html) {
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
        result.isNAT = /\bNAT\b|numerical\s*answer/i.test(html);
        result.isMSQ = /\bMSQ\b|multiple\s*select/i.test(html);
        
        const marksMatch = html.match(/(\d+)\s*marks?/i);
        if (marksMatch) result.marks = parseInt(marksMatch[1]);
        
        // Extract question content
        let questionContent = '';
        const questionPatterns = [
            /<div[^>]*class="[^"]*qa-q-view-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*post-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*itemprop="text"[^>]*>([\s\S]*?)<\/div>/i,
            /<article[^>]*>([\s\S]*?)<\/article>/i
        ];
        
        for (const pattern of questionPatterns) {
            const match = html.match(pattern);
            if (match && match[1].length > 50) {
                questionContent = match[1];
                break;
            }
        }
        
        if (!questionContent) {
            const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
            if (mainMatch) questionContent = mainMatch[1];
        }
        
        result.questionHtml = questionContent;
        result.questionText = questionContent
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Extract code blocks
        const codeMatches = html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi);
        for (const match of codeMatches) {
            const code = match[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
            if (code.length > 10) result.codeBlocks.push(code);
        }
        
        // Extract images
        const imgMatches = html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi);
        for (const match of imgMatches) {
            const src = match[1];
            if (src && !src.includes('avatar') && !src.includes('icon') && !src.includes('logo')) {
                let imgUrl = src;
                if (src.startsWith('//')) imgUrl = 'https:' + src;
                else if (src.startsWith('/')) imgUrl = 'https://gateoverflow.in' + src;
                result.images.push(imgUrl);
            }
        }
        
        // Extract MCQ options
        function cleanOptionText(text) {
            return text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        }
        
        const opts = {};
        
        // Method 1: Look for ordered list with upper-alpha
        const olMatch = (questionContent || html).match(/<ol[^>]*style="[^"]*list-style-type:\s*upper-(?:alpha|latin)[^"]*"[^>]*>([\s\S]*?)<\/ol>/i);
        if (olMatch) {
            const liMatches = [...olMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
            const labels = ['A', 'B', 'C', 'D'];
            liMatches.forEach((match, index) => {
                if (index < 4) opts[labels[index]] = cleanOptionText(match[1]);
            });
        }
        
        // Method 2: Any ordered list
        if (Object.keys(opts).length < 2) {
            const olMatches = (questionContent || html).match(/<ol[^>]*>([\s\S]*?)<\/ol>/i);
            if (olMatches) {
                const liMatches = [...olMatches[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
                const labels = ['A', 'B', 'C', 'D'];
                liMatches.forEach((match, index) => {
                    if (index < 4) opts[labels[index]] = cleanOptionText(match[1]);
                });
            }
        }
        
        // Method 3: Pattern matching (A), (B)
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
                        let text = match[2].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
                        text = text.replace(/\s*\([A-D]\)\s*$/, '').trim();
                        if (text.length > 0 && text.length < 500) opts[label] = text;
                    }
                    if (Object.keys(opts).length >= 2) break;
                }
            }
        }
        
        if (Object.keys(opts).length >= 2) {
            result.options = ['A', 'B', 'C', 'D'].map(l => ({ label: l, text: opts[l] || '' })).filter(o => o.text.length > 0);
        }
        
        if (result.options.length === 0 && !result.isNAT) {
            if (/_+|blank|fill\s*in|numerical|integer|value\s*is/i.test(questionContent)) {
                result.isNAT = true;
            }
        }
        
        if (/\bMSQ\b|multiple\s*select|more\s*than\s*one/i.test(html)) {
            result.isMSQ = true;
        }
        
        // Extract answer from button
        const buttonMatch = html.match(/Answer:\s*<\/span><button[^>]*>([A-D][;,]?[A-D]?[;,]?[A-D]?[;,]?[A-D]?)<\/button>/i);
        if (buttonMatch) {
            const rawAnswer = buttonMatch[1];
            const answers = rawAnswer.split(/[;,]/).map(a => a.trim().toUpperCase()).filter(a => /^[A-D]$/.test(a));
            if (answers.length > 0) {
                result.correctAnswer = answers.join(',');
                if (answers.length > 1) result.isMSQ = true;
            }
        }
        
        // Fallback answer patterns
        if (!result.correctAnswer) {
            const answerPatterns = [
                /Answer:\s*<\/span><button[^>]*>([A-D])<\/button>/i,
                /Answer:\s*<[^>]*>\s*([A-D])\s*<\//i,
                /Answer:\s*([A-D])\b/i,
                /The\s+answer\s+is\s+([A-D])\b/i,
                /option\s+([A-D])\s+is\s+correct/i
            ];
            
            for (const pattern of answerPatterns) {
                const match = html.match(pattern);
                if (match) {
                    result.correctAnswer = match[1].toUpperCase();
                    break;
                }
            }
        }
        
    } catch (e) {
        console.error('Parse error:', e.message);
    }
    
    return result;
}

// Check if question needs re-fetching
function needsRefetch(q) {
    // Skip protected "Uh Oh" questions (permanently blocked)
    if (q.questionHtml && q.questionHtml.includes('Uh Oh')) {
        return false;
    }
    
    // Has network error (worth retrying)
    if (q.error && (q.error.includes('ENOTFOUND') || q.error.includes('Timeout') || q.error.includes('ECONNRESET'))) {
        return true;
    }
    
    // Empty or very short questionHtml (no "Uh Oh")
    if (!q.questionHtml || q.questionHtml.length < 50) {
        return true;
    }
    
    return false;
}

// Process one topic
async function processTopic(file) {
    const topic = file.replace('_enhanced.json', '');
    const filePath = path.join(pyqsDir, file);
    
    console.log(`\n=== Processing ${topic} ===`);
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const questions = data.questions || [];
    
    // Find questions needing refetch
    const toRefetch = questions.filter(needsRefetch);
    
    if (toRefetch.length === 0) {
        console.log(`All ${questions.length} questions OK, skipping.`);
        return { topic, total: questions.length, refetched: 0, success: 0 };
    }
    
    console.log(`Found ${toRefetch.length}/${questions.length} questions to re-fetch`);
    
    let success = 0;
    let processed = 0;
    
    for (const q of toRefetch) {
        const idx = questions.findIndex(qq => qq.id === q.id || qq.link === q.link);
        
        try {
            // Log every question (console.log works better on Windows)
            console.log(`[${processed + 1}/${toRefetch.length}] Fetching: ${q.title.substring(0, 50)}...`);
            
            const html = await fetchUrl(q.link);
            const parsed = parseQuestionPage(html);
            
            // Update question with new data
            questions[idx] = {
                ...q,
                questionText: parsed.questionText || q.excerpt,
                questionHtml: parsed.questionHtml,
                codeBlocks: parsed.codeBlocks,
                images: parsed.images,
                options: parsed.options.length > 0 ? parsed.options : q.options,
                correctAnswer: parsed.correctAnswer || q.correctAnswer,
                explanation: parsed.explanation,
                isNAT: parsed.isNAT,
                isMSQ: parsed.isMSQ,
                marks: parsed.marks,
                error: undefined, // Clear error
                refetchedAt: new Date().toISOString()
            };
            
            if (parsed.questionHtml.length > 50) success++;
            
        } catch (e) {
            // Keep error info but don't overwrite existing data
            questions[idx] = {
                ...q,
                error: e.message,
                lastAttempt: new Date().toISOString()
            };
        }
        
        processed++;
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Save progress every 10 questions
        if (processed % 10 === 0) {
            const withOpts = questions.filter(q => q.options && q.options.length > 0).length;
            const withAns = questions.filter(q => q.correctAnswer).length;
            
            data.questions = questions;
            data.stats = { total: questions.length, withOptions: withOpts, withAnswers: withAns };
            data.lastRefetch = new Date().toISOString();
            
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        }
    }
    
    // Final save
    const withOpts = questions.filter(q => q.options && q.options.length > 0).length;
    const withAns = questions.filter(q => q.correctAnswer).length;
    
    data.questions = questions;
    data.stats = { total: questions.length, withOptions: withOpts, withAnswers: withAns };
    data.lastRefetch = new Date().toISOString();
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    
    console.log(`\n✓ ${topic}: Refetched ${processed}, Success: ${success}`);
    console.log(`  Options: ${withOpts}, Answers: ${withAns}`);
    
    return { topic, total: questions.length, refetched: processed, success };
}

// Count failed questions across all files
async function countFailed() {
    let totalFailed = 0;
    let totalQuestions = 0;
    
    console.log('=== Checking for Failed Questions ===\n');
    
    for (const file of enhancedFiles) {
        const topic = file.replace('_enhanced.json', '');
        const data = JSON.parse(fs.readFileSync(path.join(pyqsDir, file), 'utf8'));
        const questions = data.questions || [];
        const failed = questions.filter(needsRefetch).length;
        
        totalQuestions += questions.length;
        totalFailed += failed;
        
        if (failed > 0) {
            console.log(`${topic.padEnd(25)}: ${failed}/${questions.length} need refetch`);
        } else {
            console.log(`${topic.padEnd(25)}: OK`);
        }
    }
    
    console.log('\n' + '-'.repeat(50));
    console.log(`TOTAL: ${totalFailed}/${totalQuestions} questions need refetch`);
    
    return totalFailed;
}

// Main
async function main() {
    const failedCount = await countFailed();
    
    if (failedCount === 0) {
        console.log('\n✅ All questions fetched successfully!');
        return;
    }
    
    console.log(`\n🔄 Starting refetch of ${failedCount} questions...\n`);
    
    const results = [];
    for (const file of enhancedFiles) {
        const result = await processTopic(file);
        results.push(result);
    }
    
    console.log('\n\n=== SUMMARY ===');
    let totalRefetched = 0, totalSuccess = 0;
    results.forEach(r => {
        console.log(`${r.topic}: ${r.success}/${r.refetched} successful`);
        totalRefetched += r.refetched;
        totalSuccess += r.success;
    });
    console.log(`\nTotal: ${totalSuccess}/${totalRefetched} successfully refetched`);
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
