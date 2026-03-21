const axios = require('axios');
const fs = require('fs');
const path = require('path');
const tag = process.argv[2] || 'operating-system';
const url = `https://gateoverflow.in/tag/${tag}`;
(async()=>{
  try{
    console.log('Fetching', url);
    const res = await axios.get(url, {headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}});
    const out = path.join(__dirname,'..','data',`raw_${tag}.html`);
    fs.writeFileSync(out,res.data,'utf8');
    console.log('Saved to', out);
  }catch(e){
    console.error('Fetch failed', e.response?e.response.status:e.message);
    process.exit(1);
  }
})();
