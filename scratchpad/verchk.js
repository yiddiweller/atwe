/* The web app has no version — only a build. Prove it on the real About page. */
const SP=process.env.PW_SCRATCH||'/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'/node_modules/playwright-core');
const fs=require('fs');
const TOK=(process.env.TOK||(fs.existsSync('/tmp/tok.txt')?fs.readFileSync('/tmp/tok.txt','utf8'):'')).trim();
if(!TOK){ console.log('skipped — needs TOK'); process.exit(0); }
let pass=0, fail=0;
const ok=(n,c,d)=>{ c?pass++:fail++; console.log((c?'  ok  ':'  ✗   ')+n+(d?'  '+JSON.stringify(d):'')); };
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844}});
  await p.addInitScript(t=>localStorage.setItem('atwe_token',t), TOK);
  await p.goto('http://localhost:3000/', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ openSettings(); setNav('about'); });
  await p.waitForTimeout(600);
  const r=await p.evaluate(()=>{
    const row=document.getElementById('settingsBuildAbout');
    const lbl=row && row.closest('.iset-row').querySelector('.iset-label');
    return { val: row&&row.textContent.trim(), label: lbl&&lbl.textContent.trim(),
             build: (typeof ATWE_BUILD!=='undefined')?ATWE_BUILD:null,
             pageText: document.querySelector('.iset-body[data-page="about"]').innerText };
  });
  ok('the row is labelled Build, not Version', r.label==='Build', r);
  ok('it shows the build number and nothing else', r.val===r.build, r);
  ok('no 1.0.0 anywhere on the About page', !/1\.0\.0/.test(r.pageText), {t:r.pageText.slice(0,120)});
  ok('the word Version is gone from the page', !/\bVersion\b/.test(r.pageText), {t:r.pageText.slice(0,120)});
  /* Searching for "version" must still land somewhere, not nowhere. */
  const found=await p.evaluate(()=>{
    setNav('hub');
    const i=document.getElementById('setSearch'); if(!i) return 'no input';
    i.value='version'; setSearchInput(i.value);
    return (document.getElementById('setSearchResults')||{}).innerText||'';
  });
  ok('searching "version" still finds the Build row', /Build/.test(found), {found:String(found).slice(0,120)});
  console.log(`\n${pass} passed, ${fail} FAILED`);
  await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e); process.exit(1);});
