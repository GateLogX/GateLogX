/**
 * Batch Scrape All Subjects with Auto Re-scrape
 * Scrapes all subjects and automatically re-runs any that didn't complete fully
 * 
 * Run: node scripts/batch_scrape.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const pyqsDir = path.join(__dirname, '../data/pyqs');
const topicMapPath = path.join(__dirname, '../data/topic_map.json');

// Get all topics from topic_map.json
const topicMap = JSON.parse(fs.readFileSync(topicMapPath, 'utf8'));
const allTopics = Object.keys(topicMap);

console.log(`Found ${allTopics.length} subjects to scrape\n`);

// Function to run scraper for a topic
function scrapeTopic(topic) {
    return new Promise((resolve, reject) => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`=== Processing ${topic} ===`);
        console.log('='.repeat(60) + '\n');
        
        const scraperPath = path.join(__dirname, 'scrape_full_questions.js');
        const proc = spawn('node', [scraperPath, topic], {
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        
        proc.on('close', (code) => {
            resolve({ topic, code });
        });
        
        proc.on('error', (err) => {
            resolve({ topic, code: -1, error: err.message });
        });
    });
}

// Check if a topic is fully scraped
function checkCompletion(topic) {
    const originalPath = path.join(pyqsDir, `${topic}.json`);
    const enhancedPath = path.join(pyqsDir, `${topic}_enhanced.json`);
    
    if (!fs.existsSync(originalPath) || !fs.existsSync(enhancedPath)) {
        return { complete: false, original: 0, enhanced: 0 };
    }
    
    const original = JSON.parse(fs.readFileSync(originalPath, 'utf8'));
    const enhanced = JSON.parse(fs.readFileSync(enhancedPath, 'utf8'));
    
    const originalCount = original.questions?.length || 0;
    const enhancedCount = enhanced.questions?.length || 0;
    
    return {
        complete: enhancedCount >= originalCount,
        original: originalCount,
        enhanced: enhancedCount
    };
}

// Main batch process
async function batchScrape() {
    const startTime = Date.now();
    const results = [];
    
    // First pass: scrape all topics
    console.log('\n🚀 PHASE 1: Initial Scrape of All Topics\n');
    
    for (const topic of allTopics) {
        // Check if already complete
        const status = checkCompletion(topic);
        if (status.complete && status.enhanced > 0) {
            console.log(`⏭️  Skipping ${topic} (already complete: ${status.enhanced} questions)`);
            results.push({ topic, skipped: true, ...status });
            continue;
        }
        
        const result = await scrapeTopic(topic);
        const finalStatus = checkCompletion(topic);
        results.push({ topic, ...result, ...finalStatus });
    }
    
    // Check for incomplete
    const incomplete = results.filter(r => !r.skipped && !r.complete);
    
    if (incomplete.length > 0) {
        console.log('\n🔄 PHASE 2: Re-scraping Incomplete Topics\n');
        console.log(`Found ${incomplete.length} incomplete topics:\n`);
        
        for (const item of incomplete) {
            console.log(`  - ${item.topic}: ${item.enhanced}/${item.original}`);
        }
        
        // Re-scrape each incomplete topic (scraper now resumes automatically)
        for (const item of incomplete) {
            await scrapeTopic(item.topic);
        }
    }
    
    // Final summary
    const elapsed = Math.round((Date.now() - startTime) / 1000 / 60);
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(60) + '\n');
    
    let totalQuestions = 0;
    let completeCount = 0;
    
    for (const topic of allTopics) {
        const status = checkCompletion(topic);
        const icon = status.complete ? '✅' : '❌';
        console.log(`${icon} ${topic}: ${status.enhanced}/${status.original}`);
        totalQuestions += status.enhanced;
        if (status.complete) completeCount++;
    }
    
    console.log(`\n📈 Total: ${totalQuestions} questions scraped`);
    console.log(`📦 Complete: ${completeCount}/${allTopics.length} subjects`);
    console.log(`⏱️  Time: ${elapsed} minutes`);
    
    // Check for any still incomplete
    const stillIncomplete = allTopics.filter(t => !checkCompletion(t).complete);
    if (stillIncomplete.length > 0) {
        console.log('\n⚠️  Still incomplete:');
        stillIncomplete.forEach(t => {
            const s = checkCompletion(t);
            console.log(`   - ${t}: ${s.enhanced}/${s.original}`);
        });
        console.log('\nRun this script again to retry incomplete topics.');
    } else {
        console.log('\n🎉 All subjects fully scraped!');
    }
}

batchScrape().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
