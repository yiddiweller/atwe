/* Every Settings row that closes Settings in order to open something else. They all broke
   the same way and none of it showed up in any probe, because probes called the opener
   FUNCTION while the bug lives in what happens a frame later: Settings owns the /settings
   route, so closing it walks history back, and the popstate that lands next closes the
   surface that was just opened — _navApplyUrl shuts any route-owning panel that does not
   match the restored address. The row looked dead. This TAPS the real rows and asserts
   something is actually on screen afterwards. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP=__dirname+'/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};
(async()=>{
  const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
  const u='sh'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,verified,account_type)
    VALUES ($1,$2,$3,$4,true,true,true,'business') RETURNING id`,['Handoff',e,h,u]);
  const id=rows[0].id, t=auth.signToken({id,email:'x',is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
    localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6500);

  /* page, the row's visible label, and what must end up on screen */
  const ROWS=[
    ['security','Devices & sessions','devicesOverlay'],
    ['privacy','Who can contact you','privacyOverlay'],
    ['data','Posts you’ve read',null],
    ['assistant','Ask about your data',null],
  ];
  for(const [page,label,expect] of ROWS){
    await p.evaluate(()=>{const o=[...document.querySelectorAll('.overlay:not(.hidden)')].pop(); if(o) closeOverlay(o.id);});
    await p.waitForTimeout(500);
    await p.evaluate(()=>openSettings()); await p.waitForTimeout(1200);
    await p.evaluate(pg=>setNav(pg), page); await p.waitForTimeout(1000);
    const tapped=await p.evaluate(lb=>{
      const body=[...document.querySelectorAll('#settingsOverlay .iset-body')]
        .find(x=>getComputedStyle(x).display!=='none');
      const r=body?[...body.querySelectorAll('.iset-row')]
        .find(x=>(x.textContent||'').trim().startsWith(lb)):null;
      if(!r) return null; r.click(); return true;
    }, label);
    if(!tapped){ ok(false,'"'+label+'" — the row was not found on the '+page+' page'); continue; }
    await p.waitForTimeout(1800);
    const st=await p.evaluate(()=>({
      open:[...document.querySelectorAll('.overlay:not(.hidden)')].map(o=>o.id),
      /* a handover can also land on a full SCREEN rather than an overlay */
      screen:[...document.querySelectorAll('.ac-screen')].filter(s=>getComputedStyle(s).display!=='none').map(s=>s.id),
    }));
    const landed = st.open.length>0 || st.screen.length>0;
    ok(landed, '"'+label+'" opens something', 'overlays '+JSON.stringify(st.open)+' screens '+JSON.stringify(st.screen));
    if(expect) ok(st.open.includes(expect), '"'+label+'" opens the right thing ('+expect+')', JSON.stringify(st.open));
  }
  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
