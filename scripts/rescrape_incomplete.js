/**
 * Re-scrape Incomplete Subjects
 * Checks all _enhanced.json files and re-scrapes any that have fewer questions than the original
 * 
 * Run: node scripts/rescrape_incomplete.js
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const pyqsDir = path.join(__dirname, '../data/pyqs');

// Get all original JSON files (excluding _enhanced and index)
const originalFiles = fs.readdirSync(pyqsDir)
    .filter(f => f.endsWith('.json') && !f.includes('_enhanced') && f !== 'index.json');

console.log('=== Checking for Incomplete Scrapes ===\n');

const incomplete = [];
const complete = [];
const missing = [];

for (const file of originalFiles) {
    const topic = file.replace('.json', '');
    const originalPath = path.join(pyqsDir, file);
    const enhancedPath = path.join(pyqsDir, `${topic}_enhanced.json`);
    
    try {
        const originalData = JSON.parse(fs.readFileSync(originalPath, 'utf8'));
        const originalCount = originalData.questions?.length || 0;
        
        if (!fs.existsSync(enhancedPath)) {
            console.log(`❌ ${topic}: Enhanced file missing (${originalCount} questions to scrape)`);
            missing.push({ topic, originalCount, enhancedCount: 0, diff: originalCount });
            continue;
        }
        
        const enhancedData = JSON.parse(fs.readFileSync(enhancedPath, 'utf8'));
        const enhancedCount = enhancedData.questions?.length || 0;
        
        if (enhancedCount < originalCount) {
            const diff = originalCount - enhancedCount;
            console.log(`⚠️  ${topic}: ${enhancedCount}/${originalCount} scraped (${diff} missing)`);
            incomplete.push({ topic, originalCount, enhancedCount, diff });
        } else {
            console.log(`✅ ${topic}: ${enhancedCount}/${originalCount} complete`);
            complete.push({ topic, originalCount, enhancedCount });
        }
    } catch (e) {
        console.log(`❓ ${topic}: Error reading files - ${e.message}`);
    }
}

console.log('\n=== Summary ===');
console.log(`Complete: ${complete.length}`);
console.log(`Incomplete: ${incomplete.length}`);
console.log(`Missing: ${missing.length}`);

const toRescrape = [...missing, ...incomplete].sort((a, b) => b.diff - a.diff);

if (toRescrape.length === 0) {
    console.log('\n✅ All subjects are fully scraped!');
    process.exit(0);
}

console.log('\n=== Starting Re-scrape ===\n');

async function rescrapeAll() {
    for (const item of toRescrape) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Re-scraping: ${item.topic}`);
        console.log(`Need to scrape: ${item.diff} more questions (${item.enhancedCount}/${item.originalCount} done)`);
        console.log('='.repeat(50) + '\n');
        
        try {
            // No need to delete - scraper now resumes from where it left off
            const scraperPath = path.join(__dirname, 'scrape_full_questions.js');
            
            // Use spawn to see output in real-time
            await new Promise((resolve, reject) => {
                const proc = spawn('node', [scraperPath, item.topic], {
                    stdio: 'inherit',
                    cwd: path.join(__dirname, '..')
                });
                
                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Scraper exited with code ${code}`));
                    }
                });
                
                proc.on('error', reject);
            });
            
            console.log(`\n✅ Completed: ${item.topic}`);
            
        } catch (e) {
            console.error(`\n❌ Error scraping ${item.topic}: ${e.message}`);
        }
    }
    
    console.log('\n=== Re-scrape Complete ===');
    console.log('Run this script again to verify all subjects are complete.');
}

rescrapeAll().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
