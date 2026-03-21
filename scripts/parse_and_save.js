const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');
const tag = process.argv[2] || 'general-aptitude';
const rawPath = path.join(__dirname,'..','data',`raw_${tag}.html`);
const outPath = path.join(__dirname,'..','data','pyqs',`${tag}.json`);
if(!fs.existsSync(rawPath)){console.error('Raw HTML not found:', rawPath); process.exit(1);}
const html = fs.readFileSync(rawPath,'utf8');
const $ = cheerio.load(html);
const out = [];
$('.qa-q-list-item, .qa-q-list .qa-q-list-item').each((i,el)=>{
  const a = $(el).find('.qa-q-item-title a').first();
  const title = a.text().trim();
  let link = a.attr('href') || '';
  if(link.startsWith('../')) link = link.replace(/^\.\.\//,'/');
  if(link.startsWith('./')) link = link.replace(/^\.\//,'/');
  const excerpt = $(el).find('.qa-q-description').text().trim() || $(el).find('.qa-q-item-content').text().trim();
  if(title) out.push({title, link: link? (link.startsWith('http')?link:('https://gateoverflow.in'+link)):null, excerpt});
});
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath, JSON.stringify({tag, fetchedAt:new Date().toISOString(), questions: out}, null, 2),'utf8');
console.log('Saved', outPath, 'with', out.length, 'items');
