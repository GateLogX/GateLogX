/**
 * Create filtered GATE-only dataset
 * Extracts only actual GATE PYQs, organized by year
 */

const fs = require('fs');
const path = require('path');

const pyqsDir = path.join(__dirname, '../data/pyqs');
const outputDir = path.join(__dirname, '../data/gate_pyqs');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const files = fs.readdirSync(pyqsDir).filter(f => f.endsWith('_enhanced.json'));

console.log('=== CREATING GATE-ONLY DATASET ===\n');

// Collect all GATE questions
const gateQuestions = [];
const byYear = {};
const bySubject = {};

files.forEach(f => {
    const topic = f.replace('_enhanced.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(pyqsDir, f), 'utf8'));
    
    data.questions.forEach(q => {
        const title = q.title || '';
        
        // Match GATE questions - various formats
        const gateMatch = title.match(/GATE\s*(CSE|DA|CS|IN|EC|EE|ME|CE|CH|BT|PI|MN|MT|TF|PE|AE|AG|AR|CY|EY|GG|MA|PH|ST|XE|XH|XL)?\s*(\d{4})/i);
        
        if (gateMatch) {
            const branch = (gateMatch[1] || 'CSE').toUpperCase();
            const year = gateMatch[2];
            
            const gateQ = {
                ...q,
                topic,
                branch,
                year: parseInt(year),
                source: 'GATE'
            };
            
            gateQuestions.push(gateQ);
            
            // Group by year
            if (!byYear[year]) byYear[year] = [];
            byYear[year].push(gateQ);
            
            // Group by subject
            if (!bySubject[topic]) bySubject[topic] = [];
            bySubject[topic].push(gateQ);
        }
    });
});

console.log(`Total GATE questions found: ${gateQuestions.length}`);

// Stats
const withOpts = gateQuestions.filter(q => q.options && q.options.length >= 2).length;
const withAns = gateQuestions.filter(q => q.correctAnswer).length;
const natCount = gateQuestions.filter(q => q.isNAT).length;

console.log(`With Options: ${withOpts} (${((withOpts/gateQuestions.length)*100).toFixed(1)}%)`);
console.log(`With Answers: ${withAns} (${((withAns/gateQuestions.length)*100).toFixed(1)}%)`);
console.log(`NAT Type: ${natCount} (${((natCount/gateQuestions.length)*100).toFixed(1)}%)`);
console.log('');

// Save by subject
console.log('=== BY SUBJECT ===');
Object.keys(bySubject).sort().forEach(topic => {
    const qs = bySubject[topic];
    const opts = qs.filter(q => q.options && q.options.length >= 2).length;
    const ans = qs.filter(q => q.correctAnswer).length;
    const nat = qs.filter(q => q.isNAT).length;
    
    const outFile = path.join(outputDir, `gate_${topic}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
        topic,
        total: qs.length,
        withOptions: opts,
        withAnswers: ans,
        natType: nat,
        questions: qs
    }, null, 2));
    
    console.log(`${topic}: ${qs.length} (opts: ${opts}, ans: ${ans}, nat: ${nat})`);
});

// Save by year
console.log('\n=== BY YEAR ===');
const yearDir = path.join(outputDir, 'by_year');
if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });

Object.keys(byYear).sort().reverse().forEach(year => {
    const qs = byYear[year];
    const opts = qs.filter(q => q.options && q.options.length >= 2).length;
    const ans = qs.filter(q => q.correctAnswer).length;
    
    const outFile = path.join(yearDir, `gate_${year}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
        year: parseInt(year),
        total: qs.length,
        withOptions: opts,
        withAnswers: ans,
        questions: qs
    }, null, 2));
    
    console.log(`${year}: ${qs.length} questions`);
});

// Save complete combined file
const completeFile = path.join(outputDir, 'gate_pyqs_complete.json');
fs.writeFileSync(completeFile, JSON.stringify({
    totalQuestions: gateQuestions.length,
    withOptions: withOpts,
    withAnswers: withAns,
    natType: natCount,
    years: Object.keys(byYear).sort(),
    subjects: Object.keys(bySubject).sort(),
    questions: gateQuestions
}, null, 2));

console.log(`\n✓ Saved ${gateQuestions.length} GATE questions to ${outputDir}`);
console.log(`  - By subject: ${Object.keys(bySubject).length} files`);
console.log(`  - By year: ${Object.keys(byYear).length} files`);
console.log(`  - Complete: gate_pyqs_complete.json`);
