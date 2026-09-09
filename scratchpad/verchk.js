/* The web app shows NO version and NO build — the whole row is gone (owner, 9 Sep 2026).
   ATWE_BUILD still exists in the code and must: it is what checkForUpdate() compares and
   what a fault report is stamped with. It is simply never shown to a member. */
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
  await p.goto('http://localhost:3262/', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ openSettings(); setNav('about'); });
  await p.waitForTimeout(600);
  const r=await p.evaluate(()=>({
    row: !!document.getElementById('settingsBuildAbout'),
    build: (typeof ATWE_BUILD!=='undefined')?ATWE_BUILD:null,
    text: document.querySelector('.iset-body[data-page="about"]').innerText,
    hub: document.querySelector('.iset-body[data-page="hub"]').innerText,
  }));
  ok('the Build/Version row does not exist at all', !r.row, {row:r.row});
  ok('no "Version" anywhere on the About page', !/\bVersion\b/i.test(r.text), {t:r.text.slice(0,120)});
  ok('no "Build" anywhere on the About page', !/\bBuild\b/i.test(r.text), {t:r.text.slice(0,120)});
  /* The running build number must not leak onto the page as a bare number either. */
  ok('the build number is not printed anywhere', r.build && !r.text.includes(r.build), {build:r.build});
  ok('the About row no longer advertises one', !/\bBuild\b|\bVersion\b/i.test(r.hub.split('\n').slice(0,40).join('\n')), {});
  /* …but the constant itself is intact — the Refresh pill and error reports need it. */
  ok('ATWE_BUILD still exists in the code', !!r.build, {build:r.build});
  console.log(`\n${pass} passed, ${fail} FAILED`);
  await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e); process.exit(1);});
