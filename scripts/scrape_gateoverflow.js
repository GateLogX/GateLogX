const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE = 'https://gateoverflow.in';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchTag(tag, tagHref){
  // Fetch all pages for a tag by following "next" links.
  const seenUrls = new Set();
  let startCandidates = [];
  
  // If a full URL is provided, use ONLY that URL (no /tag/ fallbacks)
  if(tagHref && tagHref.startsWith('http')){
    startCandidates.push(tagHref);
  }else{
    // Only use /tag/ fallbacks when no full URL is given
    if(tagHref) startCandidates.push(tagHref);
    startCandidates.push(`${BASE}/${tag}`);
    startCandidates.push(`${BASE}/questions/${tag}`);
  }

  // pick first successful start URL
  let current = null;
  for(const url of startCandidates){
    try{
      console.log('Trying start URL', url);
      const r = await axios.get(url, {headers:{'User-Agent':BROWSER_UA,'Accept-Language':'en-US,en;q=0.9','Referer':BASE}});
      if(r && r.status===200){ current = url; break; }
    }catch(e){ /* ignore */ }
    await new Promise(r=>setTimeout(r,200));
  }
  if(!current) throw new Error('No start page reachable for tag: '+tag);

  const all = [];
  while(current && !seenUrls.has(current)){
    seenUrls.add(current);
    console.log('Fetching page', current);
    let res;
    try{
      res = await axios.get(current, {headers:{'User-Agent':BROWSER_UA,'Accept-Language':'en-US,en;q=0.9','Referer':BASE}});
    }catch(e){
      console.warn('Failed to fetch', current, e.response?`status ${e.response.status}`:e.message);
      break;
    }
    const $ = cheerio.load(res.data);
    // extract questions on this page
    $('.qa-q-list-item, .qa-q-list .qa-q-list-item').each((i,el)=>{
      const a = $(el).find('.qa-q-item-title a').first();
      const title = a.text().trim();
      let link = a.attr('href') || '';
      if(link.startsWith('../')) link = link.replace(/^\.\.\//,'/');
      if(link.startsWith('./')) link = link.replace(/^\.\//,'/');
      const fullLink = link ? (link.startsWith('http')?link:BASE+link) : null;
      const excerpt = $(el).find('.qa-q-description').text().trim() || $(el).find('.qa-q-item-content').text().trim();
      if(title){
        // extract numeric id if present
        const m = (fullLink||'').match(/\/(\d+)(?:\/|$)/);
        const id = m ? m[1] : (fullLink || title);
        all.push({id,title,link:fullLink,excerpt});
      }
    });

    // find next page: try link[rel=next], a[rel=next], a.qa-page-next, or 'Next' anchors
    let nextHref = null;
    nextHref = $('link[rel="next"]').attr('href') || nextHref;
    if(!nextHref) nextHref = $('a[rel="next"]').attr('href');
    if(!nextHref) nextHref = $('a.qa-page-next').attr('href');
    if(!nextHref){
      // look for pager with text next
      $('a').each((i,el)=>{
        const t = $(el).text().trim().toLowerCase();
        if((t==='next' || t==='›' || t==='»' || /next/.test(t)) && !nextHref){ nextHref = $(el).attr('href'); }
      });
    }
    if(nextHref){
      if(nextHref.startsWith('../')) nextHref = nextHref.replace(/^\.\.\//,'/');
      if(nextHref.startsWith('./')) nextHref = nextHref.replace(/^\.\//,'/');
      if(!nextHref.startsWith('http')) nextHref = BASE + (nextHref.startsWith('/')?nextHref:('/'+nextHref));
      // avoid infinite loops
      if(seenUrls.has(nextHref)) break;
      current = nextHref;
      await new Promise(r=>setTimeout(r,500 + Math.floor(Math.random()*300)));
    }else{
      break;
    }
  }

  // return unique by id preserving order
  const map = new Map();
  for(const q of all){ if(!map.has(q.id)) map.set(q.id,q); }
  return Array.from(map.values());
}

async function main(){
  const topicMapPath = path.join(__dirname,'..','data','topic_map.json');
  const topicMap = JSON.parse(fs.readFileSync(topicMapPath,'utf8'));
  const pyqDir = path.join(__dirname,'..','data','pyqs');
  if(!fs.existsSync(pyqDir)) fs.mkdirSync(pyqDir,{recursive:true});

  // Fetch the tags index to resolve actual tag URLs (helps if site uses different paths)
  const tagsIndexUrl = `${BASE}/tags`;
  let tagHrefMap = {};
  try{
    console.log('Fetching tags index', tagsIndexUrl);
    const r = await axios.get(tagsIndexUrl, {headers:{'User-Agent':BROWSER_UA}});
    const $ = cheerio.load(r.data);
    $('a[href*="/tag/"], a[href*="/tags/"]').each((i,el)=>{
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if(href && text){
        // derive tag name from href or from text
        const m = href.match(/\/tag(?:s)?\/(.+?)(\/|$|\?)/);
        if(m){
          const tagName = decodeURIComponent(m[1]);
          tagHrefMap[tagName] = href.startsWith('http')?href:BASE+href;
        }
      }
    });
  }catch(e){
    console.warn('Could not fetch tags index', e.message);
  }

  // Load or initialize central index to dedupe and merge across tags
  const indexPath = path.join(pyqDir,'index.json');
  let index = {};
  if(fs.existsSync(indexPath)){
    try{ index = JSON.parse(fs.readFileSync(indexPath,'utf8')); }catch(e){ index = {}; }
  }

  for(const subId of Object.keys(topicMap)){
    let val = topicMap[subId];
    // allow topicMap values to be either a tag slug or a full URL
    let tag = subId; // Use subId as the tag name for consistent file naming
    let tagHref = null;
    if(typeof val === 'string' && val.startsWith('http')){
      tagHref = val;
    }else{
      tagHref = tagHrefMap[val] || null;
    }
    try{
      const qs = await fetchTag(tag, tagHref);
      const outPath = path.join(pyqDir,`${tag}.json`);

      // merge into central index and record tag references
      for(const q of qs){
        const id = String(q.id);
        if(!index[id]){
          index[id] = {id, title: q.title, link: q.link, excerpt: q.excerpt||'', tags: [tag], fetchedAt: new Date().toISOString()};
        }else{
          // merge tags and update title/link if missing
          if(index[id].tags.indexOf(tag)===-1) index[id].tags.push(tag);
          if(!index[id].link && q.link) index[id].link = q.link;
          if(!index[id].title && q.title) index[id].title = q.title;
        }
      }

      fs.writeFileSync(outPath,JSON.stringify({tag, fetchedAt:new Date().toISOString(),questions:qs},null,2),'utf8');
      fs.writeFileSync(indexPath,JSON.stringify(index,null,2),'utf8');
      console.log('Saved', outPath, qs.length, 'items');
    }catch(e){
      console.error('Error fetching', tag, e.message);
    }
    // polite delay between tags
    await new Promise(r=>setTimeout(r,600 + Math.floor(Math.random()*800)));
  }
}

main().catch(e=>{console.error(e); process.exit(1);});
