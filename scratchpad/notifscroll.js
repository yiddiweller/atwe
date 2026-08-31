/* The Notifications page scrolled choppily, and the founder said so twice. The cause was
   the header retracting on scroll: that animates a 58px margin-top over 260ms, which
   REFLOWS the whole list under the finger. Hysteresis (build 1766) stopped it FLAPPING on
   a wobble but a single retraction mid-scroll still dropped a run of frames. The header
   stays put now.

   This measures the thing that was actually wrong — frame pacing — rather than a class or
   a style, and it does it with the CPU THROTTLED. That matters: on an unthrottled desktop
   this page renders a clean 60fps whether the bug is present or not, so the first version
   of this check passed on broken code. At 6x it reproduces: p95 45ms and 5 dropped frames
   before, 19ms and none after. The Account page is the yardstick — a list of the same
   shape on the same phone. */
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
  const mk=async n=>{const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
    const u=('ns'+crypto.randomUUID().replace(/-/g,'')).slice(0,12);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,verified)
      VALUES ($1,$2,$3,$4,true,true,true) RETURNING id`,[n,e,h,u]); return rows[0].id;};
  const me=await mk('Scroll Test');
  const others=[]; for(const n of ['Ana Ruiz','Ben Cole','Cara Diaz','Dov Klein','Eli Stern','Fay Roth'])
    others.push(await mk(n));
  const t=auth.signToken({id:me,email:'x',is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),me]);
  /* varied types AND distinct actors, or the list groups into one row and there is
     nothing to scroll — the trap this page's notes already record */
  const types=['message','follow','profile_update','like','reply','repost'];
  for(let i=0;i<70;i++)
    await pool.query(`INSERT INTO notifications (user_id,actor_id,type,read,created_at)
      VALUES ($1,$2,$3,false,now()-interval '${i+1} hours')`,[me,others[i%others.length],types[i%types.length]]);

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args:['--no-sandbox','--enable-gpu-rasterization']});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,isMobile:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
    localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6500);
  const cdp=await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});

  const scroll=(sel)=>p.evaluate(async(s)=>{
    const el=document.querySelector(s); if(!el) return null;
    const ov=document.getElementById('notifOverlay');
    const headTop=()=>{const h=document.getElementById('notifHead');
      return h?Math.round(h.getBoundingClientRect().top):null;};
    el.scrollTop=0; await new Promise(r=>setTimeout(r,300));
    const before=headTop();
    const d=[]; let prev=performance.now(), moved=0;
    for(let i=0;i<90;i++){
      el.scrollTop += 14;
      await new Promise(r=>requestAnimationFrame(()=>{const n=performance.now(); d.push(n-prev); prev=n; r();}));
      const now=headTop(); if(now!==null && before!==null && now!==before) moved++;
    }
    d.sort((a,b)=>a-b);
    return {p95:+d[Math.floor(d.length*0.95)].toFixed(1), janky:d.filter(x=>x>32).length,
            headMoved:moved, hadHideClass:ov?ov.classList.contains('nh-hide'):false};
  }, sel);

  await p.evaluate(()=>acNavNotifs()); await p.waitForTimeout(2200);
  const n=await scroll('#notifList');
  await p.evaluate(()=>{const o=[...document.querySelectorAll('.overlay:not(.hidden)')].pop(); if(o) closeOverlay(o.id);});
  await p.waitForTimeout(700);
  await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(2200);
  const a=await scroll('#acMeBody');

  ok(n!==null && a!==null, 'both lists are on screen to compare');
  ok(n.janky===0, 'scrolling notifications drops no frames', n.janky+' frames over 32ms, p95 '+n.p95+'ms');
  /* the yardstick: a list of the same shape elsewhere in the app, measured the same way */
  ok(n.p95 <= a.p95 + 12, 'and it paces like the Account page, not worse',
     'notifications p95 '+n.p95+'ms vs account '+a.p95+'ms');
  ok(n.headMoved===0, 'the header does not move while you scroll — that reflow WAS the jank',
     n.headMoved+' frames where it had shifted');
  ok(!n.hadHideClass, 'and nothing re-introduced the retract');
  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
