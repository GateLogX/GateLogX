const fs = require('fs');
const path = require('path');
const dir = 'data/pyqs';

// Read directly without caching
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('_enhanced') && f !== 'index.json');

console.log('=== FRESH VERIFICATION ===');
console.log('Time:', new Date().toISOString());
console.log('');

let totalOrig = 0, totalEnh = 0;

for (const f of files) {
    const topic = f.replace('.json', '');
    
    // Force re-read from disk
    delete require.cache[require.resolve(path.join(process.cwd(), dir, f))];
    delete require.cache[require.resolve(path.join(process.cwd(), dir, topic + '_enhanced.json'))];
    
    const origData = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const origCount = origData.questions?.length || 0;
    
    const enhPath = path.join(dir, topic + '_enhanced.json');
    let enhCount = 0;
    if (fs.existsSync(enhPath)) {
        const enhData = JSON.parse(fs.readFileSync(enhPath, 'utf8'));
        enhCount = enhData.questions?.length || 0;
    }
    
    totalOrig += origCount;
    totalEnh += enhCount;
    
    const status = enhCount >= origCount ? 'OK' : 'MISSING:' + (origCount - enhCount);
    console.log(topic.padEnd(25), origCount.toString().padStart(5), enhCount.toString().padStart(5), status);
}

console.log('');
console.log('TOTAL'.padEnd(25), totalOrig.toString().padStart(5), totalEnh.toString().padStart(5), totalEnh >= totalOrig ? 'ALL COMPLETE' : `MISSING: ${totalOrig - totalEnh}`);
