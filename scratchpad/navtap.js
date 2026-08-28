process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+String(x).slice(0,160):''));}};
const WANT={'bnav-home':'home','bnav-chat':'chat','bnav-search':'search','bnav-notifs':'notifs','bnav-profile':'profile'};
const NICE={'bnav-home':'Home','bnav-chat':'Beam','bnav-search':'Engine','bnav-notifs':'Notifications','bnav-profile':'Account'};
const DELAYS=[30,60,90,120,150,190];
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='nt'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('N',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  const rest=await p.evaluate(ids=>{const o={};ids.forEach(id=>{const r=document.getElementById(id).getBoundingClientRect();
    o[id]={x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};});return o;},Object.keys(NICE));
  console.log('resting centres: '+Object.keys(NICE).map(i=>NICE[i]+'@'+rest[i].x).join('  '));

  const goHome=async()=>{ await p.evaluate(()=>appTab('home')); await p.waitForTimeout(800);
    await p.evaluate(()=>{const se=document.scrollingElement;se.scrollTop=0;}); await p.waitForTimeout(350); };

  for (const delay of DELAYS) {
    console.log('\n── the finger lands '+delay+'ms into the expansion ──');
    for (const id of Object.keys(NICE)) {
      await goHome();
      await p.mouse.move(195, 500);
      for (let i=0;i<8;i++){ await p.mouse.wheel(0, 90); await p.waitForTimeout(55); }
      await p.waitForTimeout(650);
      if (!await p.evaluate(()=>document.body.classList.contains('nav-ball'))) { ok(false,'the bar collapsed to the ball'); break; }
      // Scroll up (starts the expansion), then tap at an EXACT offset from inside the
      // page — Playwright's own click latency is tens of ms, which overshot the window.
      const got = await p.evaluate(async ({x,y,delay}) => {
        const wheel = (dy) => window.dispatchEvent(new WheelEvent('wheel',{deltaY:dy,bubbles:true}));
        const se = document.scrollingElement;
        se.scrollTop = Math.max(0, se.scrollTop - 260);        // real scroll-up -> _setNavBall(false)
        window.dispatchEvent(new Event('scroll'));
        await new Promise(r=>setTimeout(r, delay));
        // Hit-test then dispatch exactly as the browser does for a real tap.
        const el = document.elementFromPoint(x,y);
        if (el) el.dispatchEvent(new MouseEvent('click',{clientX:x,clientY:y,bubbles:true,cancelable:true,view:window}));
        await new Promise(r=>setTimeout(r, 900));
        if (document.body.classList.contains('notif-tab')) return 'notifs';
        const on=document.querySelector('#bottomNav .bn-tab.active');
        return on ? on.id.replace('bnav-','') : 'none';
      }, {x:rest[id].x, y:rest[id].y, delay});
      ok(got===WANT[id], 'tap on '+NICE[id]+' opens '+NICE[id], 'opened "'+got+'"');
    }
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
