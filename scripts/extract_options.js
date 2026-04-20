/**
 * Extract Options & Answers from existing questionHtml
 * Tries to parse options that may have been missed during initial scrape
 */

const fs = require('fs');
const path = require('path');

const pyqsDir = path.join(__dirname, '../data/pyqs');
const tempDir = 'C:/temp_gate_fix';

// Ensure temp dir exists
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

function cleanText(text) {
    return text
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n))
        .replace(/\s+/g, ' ')
        .trim();
}

function extractOptions(html) {
    if (!html || html.length < 20) return [];
    
    const opts = {};
    
    // Method 1: Ordered list with upper-alpha style
    const olMatch = html.match(/<ol[^>]*style="[^"]*list-style-type:\s*upper-(?:alpha|latin)[^"]*"[^>]*>([\s\S]*?)<\/ol>/i);
    if (olMatch) {
        const liMatches = [...olMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
        const labels = ['A', 'B', 'C', 'D'];
        liMatches.forEach((match, i) => {
            if (i < 4) opts[labels[i]] = cleanText(match[1]);
        });
    }
    
    // Method 2: Any ordered list in question
    if (Object.keys(opts).length < 2) {
        const olMatches = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/gi);
        if (olMatches) {
            for (const ol of olMatches) {
                const liMatches = [...ol.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
                if (liMatches.length >= 2 && liMatches.length <= 5) {
                    const labels = ['A', 'B', 'C', 'D', 'E'];
                    liMatches.forEach((match, i) => {
                        if (i < 5) opts[labels[i]] = cleanText(match[1]);
                    });
                    if (Object.keys(opts).length >= 2) break;
                }
            }
        }
    }
    
    // Method 3: Pattern (A) text (B) text
    if (Object.keys(opts).length < 2) {
        const patterns = [
            /\(([A-D])\)\s*([^(]+?)(?=\s*\([A-D]\)|$)/gi,
            /(?:^|[\s>])([A-D])\)\s*([^\n<]+?)(?=\s*[A-D]\)|<|$)/gim,
            /(?:^|[\s>])([A-D])\.\s*([^\n<]+?)(?=\s*[A-D]\.|<|$)/gim
        ];
        
        for (const pattern of patterns) {
            const matches = [...html.matchAll(pattern)];
            if (matches.length >= 2) {
                for (const m of matches) {
                    const label = m[1].toUpperCase();
                    const text = cleanText(m[2]);
                    if (text.length > 0 && text.length < 500) {
                        opts[label] = text;
                    }
                }
                if (Object.keys(opts).length >= 2) break;
            }
        }
    }
    
    // Method 4: Table rows with A, B, C, D
    if (Object.keys(opts).length < 2) {
        const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
        if (tableMatch) {
            const tdMatches = [...tableMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
            for (let i = 0; i < tdMatches.length - 1; i++) {
                const cell = cleanText(tdMatches[i][1]);
                if (/^[A-D]\.?$/.test(cell)) {
                    const nextCell = cleanText(tdMatches[i + 1][1]);
                    if (nextCell.length > 0 && nextCell.length < 500) {
                        opts[cell.replace('.', '')] = nextCell;
                    }
                }
            }
        }
    }
    
    if (Object.keys(opts).length >= 2) {
        return ['A', 'B', 'C', 'D', 'E'].map(l => ({ label: l, text: opts[l] || '' })).filter(o => o.text.length > 0);
    }
    
    return [];
}

function extractAnswer(html, questionText) {
    if (!html) return null;
    
    const text = html + ' ' + (questionText || '');
    
    // Method 1: Answer button
    const buttonMatch = text.match(/Answer:\s*<\/span><button[^>]*>([A-D,;]+)<\/button>/i);
    if (buttonMatch) {
        const ans = buttonMatch[1].split(/[,;]/).map(a => a.trim().toUpperCase()).filter(a => /^[A-D]$/.test(a));
        if (ans.length > 0) return ans.join(',');
    }
    
    // Method 2: Various answer patterns
    const patterns = [
        /Answer:\s*<[^>]*>([A-D])<\//i,
        /Answer:\s*\(?([A-D])\)?[\s<]/i,
        /correct\s+(?:answer|option)\s*(?:is)?\s*:?\s*\(?([A-D])\)?/i,
        /option\s+\(?([A-D])\)?\s+is\s+correct/i,
        /The\s+answer\s+is\s+\(?([A-D])\)?/i,
        /\bans(?:wer)?[\s:=]+\(?([A-D])\)?/i
    ];
    
    for (const p of patterns) {
        const m = text.match(p);
        if (m) return m[1].toUpperCase();
    }
    
    return null;
}

function isNATQuestion(html, questionText) {
    const text = (html || '') + ' ' + (questionText || '');
    return /\bNAT\b|numerical\s*answer|fill\s*in\s*the\s*blank|integer\s*type|___+/i.test(text);
}

// Process all files
const files = fs.readdirSync(pyqsDir).filter(f => f.endsWith('_enhanced.json'));

console.log('=== EXTRACTING OPTIONS & ANSWERS FROM EXISTING DATA ===\n');

let totalExtractedOpts = 0;
let totalExtractedAns = 0;
let totalNATMarked = 0;

for (const file of files) {
    const topic = file.replace('_enhanced.json', '');
    const srcPath = path.join(pyqsDir, file);
    const tempPath = path.join(tempDir, file);
    
    const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    const qs = data.questions || [];
    
    let extractedOpts = 0;
    let extractedAns = 0;
    let natMarked = 0;
    
    qs.forEach((q, i) => {
        // Try to extract options if missing
        if (!q.options || q.options.length < 2) {
            const opts = extractOptions(q.questionHtml);
            if (opts.length >= 2) {
                data.questions[i].options = opts;
                extractedOpts++;
            }
        }
        
        // Try to extract answer if missing
        if (!q.correctAnswer) {
            const ans = extractAnswer(q.questionHtml, q.questionText);
            if (ans) {
                data.questions[i].correctAnswer = ans;
                extractedAns++;
            }
        }
        
        // Mark NAT questions
        if (!q.isNAT && (!q.options || q.options.length < 2)) {
            if (isNATQuestion(q.questionHtml, q.questionText)) {
                data.questions[i].isNAT = true;
                natMarked++;
            }
        }
    });
    
    if (extractedOpts > 0 || extractedAns > 0 || natMarked > 0) {
        data.EXTRACT_TIME = Date.now();
        
        // Write to temp then copy (OneDrive workaround)
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
        fs.copyFileSync(tempPath, srcPath);
        
        console.log(`${topic}: +${extractedOpts} opts, +${extractedAns} ans, +${natMarked} NAT`);
        totalExtractedOpts += extractedOpts;
        totalExtractedAns += extractedAns;
        totalNATMarked += natMarked;
    }
}

console.log(`\n=== EXTRACTED: +${totalExtractedOpts} options, +${totalExtractedAns} answers, +${totalNATMarked} NAT ===`);
