process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,420):''));}};

/* Everything acShow() manages. The Atwe AI page is not an AC_SCREENS screen, so acShow
   never runs for it and any of these can carry over from the world you arrived from. */
const FINGERPRINT = () => {
  const bodyKeys = ['feeds-immersive','feed-cover','brand-collapse','home-feed','pwa-installed',
                    'pgscroll','pgscroll-search','beam-has-chat','notif-tab','nav-ball','tb-collapsed'];
  const body = {}; bodyKeys.forEach(k => body[k] = document.body.classList.contains(k));
  const tb = document.querySelector('.topbar');
  const tbKeys = ['hidden','tabs-live','tb-plain','tb-home','tb-chat','tb-engine','tb-solo','tb-ai'];
  const topbar = {}; tbKeys.forEach(k => topbar[k] = !!tb && tb.classList.contains(k));
  const disp = (id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; };
  const cls  = (id, c) => { const e = document.getElementById(id); return !!e && e.classList.contains(c); };
  const main = document.querySelector('.main');
  return {
    body, topbar,
    htmlOverflow: document.documentElement.style.overflow || '(unset)',
    mainDisplay: main ? getComputedStyle(main).display : 'missing',
    mainHeight:  main ? Math.round(main.getBoundingClientRect().height) : -1,
    navOff: cls('bottomNav','nav-off'),
    navDisplay: disp('bottomNav'),
    tabTouch: disp('tbTabTouch'),
    revealBar: disp('tbRevealBar'),
    feedTabs: disp('tbFeedTabs'),
    chatTabs: disp('tbChatTabs'),
    tabRow: disp('tbTabRow'),
    aiBackShown: disp('tbAiBack'),
    composerBottomGap: (() => { const w = document.getElementById('inputWrap');
      return w ? Math.round(innerHeight - w.getBoundingClientRect().bottom) : -1; })(),
  };
};

(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='lk'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('L',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  for(let i=0;i<6;i++){const {rows:a}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified) VALUES ('A',$1,$2,$3,true) RETURNING id`,[crypto.randomUUID().slice(0,8)+'@t.local',hash,'lx'+crypto.randomUUID().replace(/-/g,'').slice(0,9)]);
    await pool.query("INSERT INTO notifications (user_id,actor_id,type,read) VALUES ($1,$2,$3,false)",[rows[0].id,a[0].id,['follow','like','reply','mention','repost','endorse'][i]]);}

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  await p.evaluate(f=>{ window.__fp = new Function('return ('+f+')()'); }, FINGERPRINT.toString());

  const goWorld = async (w) => {
    if (w === 'notifs') { await p.evaluate(()=>appTab('home')); await p.waitForTimeout(900);
      await p.click('#bnav-notifs'); await p.waitForTimeout(1800); }
    else { await p.evaluate(t=>appTab(t), w); await p.waitForTimeout(1700); }
  };
  const scrollABit = async () => {   // leave the world in a SCROLLED state — that is what
    await p.mouse.move(195,500);      // arms pgscroll / nav-ball / collapsed headers
    for (let i=0;i<6;i++){ await p.mouse.wheel(0,110); await p.waitForTimeout(50); }
    await p.waitForTimeout(600);
  };
  const fp = async () => p.evaluate(()=>window.__fp());

  const WORLDS = ['home','chat','search','profile','notifs'];
  const shots = {};
  for (const w of WORLDS) {
    await goWorld(w);
    await scrollABit();
    await p.evaluate(()=>appTab('ai'));
    await p.waitForTimeout(1900);
    shots[w] = await fp();
  }

  // ── the invariant: the AI page must look the same no matter where you came from ──
  const base = JSON.stringify(shots[WORLDS[0]], null, 1);
  console.log('\nAI page chrome, arriving from Home:\n' + base.split('\n').map(l=>'    '+l).join('\n'));
  console.log('\nDifferences when arriving from the other worlds:');
  let leaks = 0;
  for (const w of WORLDS.slice(1)) {
    const diff = [];
    const walk = (a,b,path) => {
      for (const k of Object.keys(a)) {
        if (a[k] && typeof a[k]==='object') walk(a[k], b[k]||{}, path?path+'.'+k:k);
        else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diff.push((path?path+'.':'')+k+': from Home='+JSON.stringify(a[k])+' but from '+w+'='+JSON.stringify(b[k]));
      }
    };
    walk(shots[WORLDS[0]], shots[w], '');
    if (diff.length) { leaks += diff.length; console.log('  from '+w+':'); diff.forEach(d=>console.log('     · '+d)); }
    else console.log('  from '+w+': identical');
  }
  ok(leaks===0, 'the Atwe AI page looks the same arriving from all five worlds (no leaked chrome)', leaks+' difference(s) — see above');

  // ── and it must be CORRECT, not merely consistent ──
  const s = shots.home;
  ok(s.navOff===true && s.navDisplay==='none', 'the bottom bar is hidden', JSON.stringify({navOff:s.navOff,d:s.navDisplay}));
  ok(s.tabTouch==='none', "Home's transparent tab-strip is not left over the page", s.tabTouch);
  ok(s.body.pgscroll===false && s.body['pgscroll-search']===false, 'page-scroll mode is off', JSON.stringify(s.body));
  ok(s.htmlOverflow==='(unset)' || s.htmlOverflow==='', "the document's overflow is not left forced", s.htmlOverflow);
  ok(s.mainDisplay==='flex', 'the page column is a flex column so the composer can reach the bottom', s.mainDisplay);
  ok(s.mainHeight>=800, 'the page column fills the screen', s.mainHeight+'px of 844');
  ok(s.aiBackShown!=='none', 'the back arrow is shown');
  ok(s.body['beam-has-chat']===false, "Beam's open-conversation flag is not left on", JSON.stringify(s.body));
  ok(s.body['feeds-immersive']===false, 'immersive-feed mode is not left on', JSON.stringify(s.body));
  ok(s.body['nav-ball']===false && s.body['tb-collapsed']===false, 'the scroll-collapsed nav/header state is not left on', JSON.stringify(s.body));
  ok(s.feedTabs==='none' && s.chatTabs==='none', "another world's tab row is not left showing", JSON.stringify({f:s.feedTabs,c:s.chatTabs}));
  ok(s.revealBar==='none', 'the scroll-up reveal bar is not left showing', s.revealBar);

  // ── leaving must restore each world ──
  console.log('\nLeaving the AI page:');
  for (const w of WORLDS) {
    await goWorld(w); await scrollABit();
    await p.evaluate(()=>appTab('ai')); await p.waitForTimeout(1500);
    await p.click('#tbAiBack'); await p.waitForTimeout(1900);
    const back = await p.evaluate(()=>{
      const nav=document.getElementById('bottomNav');
      const on=document.querySelector('#bottomNav .bn-tab.active');
      const main=document.querySelector('.main');
      return {lit:on?on.id.replace('bnav-',''):'none',
        navShown:getComputedStyle(nav).display!=='none' && !nav.classList.contains('nav-off'),
        notif:document.body.classList.contains('notif-tab'),
        mainH:Math.round(main.getBoundingClientRect().height)};
    });
    /* Notifications is a PANEL, not a world — it never changes _appTab, so the world the
       AI page was opened from is whatever the panel was covering (Home here). Landing on
       Home with the panel closed is correct, not a miss. */
    const want = w==='notifs' ? 'home' : w;
    const got = back.notif ? 'notifs' : back.lit;
    const label = w==='notifs' ? '  back from AI (opened over the Alerts panel) returns to the world beneath it'
                               : '  back from AI returns to '+w+' with the bar restored';
    ok(got===want && back.navShown, label, JSON.stringify(back));
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
