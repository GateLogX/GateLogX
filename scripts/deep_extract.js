/**
 * Deep extraction of options/answers from existing questionHtml
 * Uses multiple parsing strategies to find options that may have been missed
 */

const fs = require('fs');
const path = require('path');

const pyqsDir = path.join(__dirname, '../data/pyqs');
const tempDir = 'C:/temp_gate_fix';

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

function extractOptionsDeep(html, text) {
    if (!html && !text) return [];
    
    const content = (html || '') + ' ' + (text || '');
    const opts = {};
    
    // Strategy 1: Standard ordered list
    const olMatches = content.match(/<ol[^>]*>([\s\S]*?)<\/ol>/gi);
    if (olMatches) {
        for (const ol of olMatches) {
            const liMatches = [...ol.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
            if (liMatches.length >= 2 && liMatches.length <= 5) {
                const labels = ['A', 'B', 'C', 'D', 'E'];
                liMatches.forEach((match, i) => {
                    if (i < 5) {
                        const txt = cleanText(match[1]);
                        if (txt.length > 0 && txt.length < 500) opts[labels[i]] = txt;
                    }
                });
                if (Object.keys(opts).length >= 2) break;
            }
        }
    }
    
    // Strategy 2: (A) Option text pattern - greedy
    if (Object.keys(opts).length < 2) {
        const patterns = [
            /\(A\)\s*([\s\S]*?)\s*\(B\)\s*([\s\S]*?)\s*\(C\)\s*([\s\S]*?)\s*\(D\)\s*([\s\S]*?)(?:\(E\)|$)/i,
            /\(A\)(.*?)\(B\)(.*?)\(C\)(.*?)\(D\)(.*?)(?:\(E\)|<|$)/is
        ];
        for (const p of patterns) {
            const m = content.match(p);
            if (m) {
                ['A', 'B', 'C', 'D'].forEach((l, i) => {
                    const txt = cleanText(m[i + 1]);
                    if (txt.length > 0 && txt.length < 500) opts[l] = txt;
                });
                if (Object.keys(opts).length >= 2) break;
            }
        }
    }
    
    // Strategy 3: A) Option or A. Option pattern
    if (Object.keys(opts).length < 2) {
        const patterns = [
            /(?:^|[\s>])([A-D])\)\s*([^\n<]+?)(?=\s*[A-D]\)|<|$)/gim,
            /(?:^|[\s>])([A-D])\.\s*([^\n<]+?)(?=\s*[A-D]\.|<|$)/gim,
            /\(([A-D])\)\s*([^(\n]+?)(?=\s*\([A-D]\)|$)/gi
        ];
        for (const pattern of patterns) {
            const matches = [...content.matchAll(pattern)];
            if (matches.length >= 2) {
                for (const m of matches) {
                    const label = m[1].toUpperCase();
                    const txt = cleanText(m[2]);
                    if (txt.length > 0 && txt.length < 500 && !opts[label]) {
                        opts[label] = txt;
                    }
                }
                if (Object.keys(opts).length >= 2) break;
            }
        }
    }
    
    // Strategy 4: Table-based options
    if (Object.keys(opts).length < 2) {
        const tableMatch = content.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
        if (tableMatch) {
            const cells = [...tableMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
            for (let i = 0; i < cells.length - 1; i++) {
                const cell = cleanText(cells[i][1]);
                if (/^[A-D]\.?$/.test(cell)) {
                    const next = cleanText(cells[i + 1][1]);
                    if (next.length > 0 && next.length < 500) {
                        opts[cell.replace('.', '')] = next;
                    }
                }
            }
        }
    }
    
    // Strategy 5: Line-by-line extraction
    if (Object.keys(opts).length < 2) {
        const lines = content.split(/[\n<]/);
        for (const line of lines) {
            const m = line.match(/^\s*\(?([A-D])\)?[.\)]\s*(.+)/i);
            if (m) {
                const label = m[1].toUpperCase();
                const txt = cleanText(m[2]);
                if (txt.length > 0 && txt.length < 500 && !opts[label]) {
                    opts[label] = txt;
                }
            }
        }
    }
    
    // Strategy 6: MathJax/LaTeX options $A$, $B$
    if (Object.keys(opts).length < 2) {
        const mathPatterns = [
            /\$\s*([A-D])\s*\$\s*[:\.\)]\s*([^$]+?)(?=\$\s*[A-D]\s*\$|$)/gi,
            /\\text\{([A-D])\}\s*[:\.\)]\s*([^\\]+?)(?=\\text\{[A-D]\}|$)/gi
        ];
        for (const p of mathPatterns) {
            const matches = [...content.matchAll(p)];
            if (matches.length >= 2) {
                for (const m of matches) {
                    opts[m[1].toUpperCase()] = cleanText(m[2]);
                }
                if (Object.keys(opts).length >= 2) break;
            }
        }
    }
    
    if (Object.keys(opts).length >= 2) {
        return ['A', 'B', 'C', 'D', 'E'].map(l => ({ label: l, text: opts[l] || '' })).filter(o => o.text.length > 0);
    }
    return [];
}

function extractAnswerDeep(html, text) {
    const content = (html || '') + ' ' + (text || '');
    
    const patterns = [
        // Button-based answer
        /Answer:\s*<\/span><button[^>]*>([A-D,;]+)<\/button>/i,
        // Span/div answer
        /Answer:\s*<[^>]*>\s*([A-D])\s*<\//i,
        // Text answer
        /Answer:\s*\(?([A-D])\)?[\s<.,]/i,
        /correct\s+answer\s*(?:is)?\s*:?\s*\(?([A-D])\)?/i,
        /answer\s*(?:is)?\s*:?\s*option\s*\(?([A-D])\)?/i,
        /option\s*\(?([A-D])\)?\s*is\s*(?:the\s*)?correct/i,
        /\bans(?:wer)?[\s:=]+\(?([A-D])\)?/i,
        // Pattern: (A) is correct, Answer: A
        /\(([A-D])\)\s*is\s*correct/i,
        // Bold/strong answer
        /<(?:b|strong)[^>]*>\s*([A-D])\s*<\/(?:b|strong)>/i
    ];
    
    for (const p of patterns) {
        const m = content.match(p);
        if (m) {
            const ans = m[1].split(/[,;]/).map(a => a.trim().toUpperCase()).filter(a => /^[A-D]$/.test(a));
            if (ans.length > 0) return ans.join(',');
        }
    }
    
    return null;
}

function isNATQuestion(html, text) {
    const content = ((html || '') + ' ' + (text || '')).toLowerCase();
    return /\bnat\b|numerical\s*answer|fill\s*in|integer\s*type|___+|the\s*value\s*is|answer\s*is\s*\d/.test(content);
}

// Process all files
const files = fs.readdirSync(pyqsDir).filter(f => f.endsWith('_enhanced.json'));

console.log('=== DEEP EXTRACTION FROM EXISTING DATA ===\n');

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

let totalNewOpts = 0, totalNewAns = 0, totalNewNAT = 0;

for (const file of files) {
    const topic = file.replace('_enhanced.json', '');
    const srcPath = path.join(pyqsDir, file);
    const tempPath = path.join(tempDir, file);
    
    const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    const qs = data.questions || [];
    
    let newOpts = 0, newAns = 0, newNAT = 0;
    
    qs.forEach((q, i) => {
        // Skip if already has options
        if (!q.options || q.options.length < 2) {
            // Check if it's NAT first
            if (isNATQuestion(q.questionHtml, q.questionText || q.excerpt)) {
                if (!q.isNAT) {
                    data.questions[i].isNAT = true;
                    newNAT++;
                }
            } else {
                // Try to extract options
                const opts = extractOptionsDeep(q.questionHtml, q.questionText || q.excerpt);
                if (opts.length >= 2) {
                    data.questions[i].options = opts;
                    newOpts++;
                }
            }
        }
        
        // Try to extract answer if missing
        if (!q.correctAnswer) {
            const ans = extractAnswerDeep(q.questionHtml, q.questionText || q.excerpt);
            if (ans) {
                data.questions[i].correctAnswer = ans;
                newAns++;
            }
        }
    });
    
    if (newOpts > 0 || newAns > 0 || newNAT > 0) {
        data.DEEP_EXTRACT_TIME = Date.now();
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
        fs.copyFileSync(tempPath, srcPath);
        console.log(`${topic}: +${newOpts} opts, +${newAns} ans, +${newNAT} NAT`);
    }
    
    totalNewOpts += newOpts;
    totalNewAns += newAns;
    totalNewNAT += newNAT;
}

console.log(`\n=== TOTAL: +${totalNewOpts} opts, +${totalNewAns} ans, +${totalNewNAT} NAT ===`);

// Show current stats
console.log('\n=== CURRENT COVERAGE ===');
let totalQ = 0, totalOpts = 0, totalAns = 0, totalNAT = 0;
for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(pyqsDir, file), 'utf8'));
    const qs = data.questions || [];
    totalQ += qs.length;
    totalOpts += qs.filter(q => q.options && q.options.length >= 2).length;
    totalAns += qs.filter(q => q.correctAnswer).length;
    totalNAT += qs.filter(q => q.isNAT).length;
}
console.log(`Questions: ${totalQ}`);
console.log(`With Options: ${totalOpts} (${((totalOpts/totalQ)*100).toFixed(1)}%)`);
console.log(`With Answers: ${totalAns} (${((totalAns/totalQ)*100).toFixed(1)}%)`);
console.log(`NAT Type: ${totalNAT} (${((totalNAT/totalQ)*100).toFixed(1)}%)`);
console.log(`MCQ needing options: ${totalQ - totalOpts - totalNAT}`);
