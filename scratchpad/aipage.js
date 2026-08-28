process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+String(x).slice(0,180):''));}};
const NICE={home:'Home',chat:'Beam',search:'Engine',profile:'Account'};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='ai'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('A',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const [w,hgt,lab] of [[390,844,'phone'],[1440,900,'desktop']]) {
    const p=await b.newPage({viewport:{width:w,height:hgt},hasTouch:w<800,isMobile:w<800,deviceScaleFactor:2});
    p.on('pageerror',e=>errs.push(lab+': '+String(e).slice(0,120)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5200);
    const state=()=>p.evaluate(()=>{
      const nav=document.getElementById('bottomNav'), back=document.getElementById('tbAiBack');
      const cn=getComputedStyle(nav), cb=getComputedStyle(back);
      const on=document.querySelector('#bottomNav .bn-tab.active, .sb-navbtn.active');
      const sb=document.querySelector('#snav-home');
      return {navShown:cn.display!=='none' && !nav.classList.contains('nav-off'),
        sidebarOut: !!(sb && sb.getBoundingClientRect().width>0),
        backShown:cb.display!=='none',
        title:(document.getElementById('tbBrandWordTxt')||{}).textContent,
        lit:on?on.id.replace(/^[bs]nav-/,''):'none',
        path:location.pathname};
    });
    // ── from each world: open AI, check chrome, then come back ──
    for (const from of ['home','chat','search','profile']) {
      await p.evaluate(t=>appTab(t),from); await p.waitForTimeout(1400);
      await p.evaluate(()=>appTab('ai')); await p.waitForTimeout(1600);
      const ai=await state();
      ok(!ai.navShown, '['+lab+'] from '+NICE[from]+': the bottom bar is gone on Atwe AI', JSON.stringify(ai));
      ok(ai.title==='Atwe AI', '['+lab+'] from '+NICE[from]+': the page is titled Atwe AI', ai.title);
      if (lab==='phone') {
        ok(ai.backShown, '[phone] from '+NICE[from]+': a back arrow is shown top-left', JSON.stringify(ai));
      } else {
        // On desktop the world header only exists below 769px — the SIDEBAR is the nav and
        // it never goes away, so there is no trap here and no arrow is needed.
        ok(ai.sidebarOut, '[desktop] from '+NICE[from]+': the sidebar is still there to leave by', JSON.stringify(ai));
      }
      if (from==='home' && lab==='phone') await p.screenshot({path:SP+'icons/AI-inside.png'});
      if (lab==='phone') await p.click('#tbAiBack');
      else await p.click('#snav-'+from);
      await p.waitForTimeout(1600);
      const back=await state();
      ok(back.lit===from, '['+lab+'] the arrow returns to '+NICE[from], 'landed on "'+back.lit+'"');
      if (lab==='phone') {
        ok(back.navShown, '[phone] and the bottom bar comes back', JSON.stringify(back));
        ok(!back.backShown, '[phone] and the arrow is gone again');
      }
    }
    // ── the browser/hardware Back leaves the AI page too ──
    await p.evaluate(()=>appTab('chat')); await p.waitForTimeout(1300);
    await p.evaluate(()=>appTab('ai')); await p.waitForTimeout(1500);
    await p.evaluate(()=>appGoBack()); await p.waitForTimeout(1500);
    const hw=await state();
    ok(hw.lit==='chat', '['+lab+'] the system Back also leaves Atwe AI for the world it came from', JSON.stringify(hw));
    // ── the one scenario that could strand someone: the app RELOADS while on Atwe AI
    //    (iOS reclaims a backgrounded PWA tab and boot() restores the last tab). There is
    //    no remembered world to go back to, so the arrow must still be there and must
    //    fall back to Home rather than leaving them on a page with no bar and no way out.
    await p.evaluate(()=>appTab('ai')); await p.waitForTimeout(1200);
    await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(5200);
    const re=await state();
    ok(re.title==='Atwe AI', '['+lab+'] after a reload it is still on Atwe AI (last-tab restore)', JSON.stringify(re));
    if (lab==='phone') {
      ok(re.backShown && !re.navShown, '[phone] the back arrow is there after a reload, bar still hidden', JSON.stringify(re));
      await p.click('#tbAiBack'); await p.waitForTimeout(1600);
      const home=await state();
      ok(home.lit==='home' && home.navShown, '[phone] with nothing to go back to it falls back to Home, bar restored', JSON.stringify(home));
    } else {
      ok(re.sidebarOut, '[desktop] the sidebar is still there after a reload', JSON.stringify(re));
    }
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
