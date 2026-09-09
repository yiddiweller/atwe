/* Ask the APP for every destination it believes it has. */
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'/node_modules/playwright-core');
const TOK=require('fs').readFileSync('/tmp/tok.txt','utf8').trim();
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844}});
  await p.addInitScript(t=>localStorage.setItem('atwe_token',t), TOK);
  await p.goto('http://localhost:3262/',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  const d=await p.evaluate(()=>{
    const idx = acAppIndex();
    return { total: idx.length,
      bySub: idx.reduce((a,x)=>{a[x.sub]=(a[x.sub]||0)+1;return a;},{}),
      items: idx.map(x=>({name:x.name||x.label||x.title||x.t||'?', sub:x.sub, run:String(x.run||''), keys:Object.keys(x).join(',')})) };
  });
  require('fs').writeFileSync(SP+'destinations.json', JSON.stringify(d,null,1));
  console.log('destinations:', d.total);
  console.log(JSON.stringify(d.bySub,null,1));
  await b.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
