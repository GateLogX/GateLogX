const fs = require('fs');
const cheerio = require('cheerio');
const tag = process.argv[2] || 'operating-system';
const p = `data/raw_${tag}.html`;
if(!fs.existsSync(p)){console.error('File not found',p); process.exit(1);}
const html = fs.readFileSync(p,'utf8');
const $ = cheerio.load(html);
const out = [];
$('.qa-q-list-item, .qa-q-list .qa-q-list-item, .qa-q-list-item').each((i,el)=>{
  const a = $(el).find('.qa-q-item-title a').first();
  const title = a.text().trim();
  let link = a.attr('href') || '';
  if(link.startsWith('../')) link = link.replace(/^\.\.\//,'/');
  const excerpt = $(el).find('.qa-q-description').text().trim() || $(el).find('.qa-q-item-content').text().trim();
  if(title) out.push({title, link, excerpt});
});
console.log('Found', out.length, 'items');
console.log(out.slice(0,10));
