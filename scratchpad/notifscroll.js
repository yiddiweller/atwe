/* The Notifications header retracts on scroll, and retracting animates a 58px margin-top —
   which REFLOWS the list under the finger. With the old 4px threshold, ordinary scroll
   jitter flipped it open and shut over and over and the content jumped each time; the
   founder reported the page as not scrolling smoothly. This drives a realistic wobbling
   scroll (a finger never travels in one direction) and counts how many times the header
   changes state. One or two is a real retraction; a dozen is the flapping. */
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
  const others=[]; for(const n of ['Ana Ruiz','Ben Cole','Cara Diaz','Dov Klein']) others.push(await mk(n));
  const t=auth.signToken({id:me,email:'x',is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),me]);
  /* varied types AND distinct actors, or the list groups into one row and there is
     nothing to scroll — the trap this page's notes already record */
  const types=['message','follow','profile_update','like','reply'];
  for(let i=0;i<40;i++)
    await pool.query(`INSERT INTO notifications (user_id,actor_id,type,read,created_at)
      VALUES ($1,$2,$3,false,now()-interval '${i+1} hours')`,[me,others[i%others.length],types[i%types.length]]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
    localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6500);
  await p.evaluate(()=>acNavNotifs()); await p.waitForTimeout(2200);

  const r=await p.evaluate(async()=>{
    const list=document.getElementById('notifList'), ov=document.getElementById('notifOverlay');
    if(!list) return null;
    let flips=0, was=ov.classList.contains('nh-hide');
    const obs=new MutationObserver(()=>{const now=ov.classList.contains('nh-hide');
      if(now!==was){flips++;was=now;}});
    obs.observe(ov,{attributes:true,attributeFilter:['class']});
    /* a real finger: mostly down, with the small back-and-forth every hand makes */
    const steps=[9,7,-3,11,8,-4,10,6,-2,12,9,-3,8,7,-5,11];
    for(const d of steps){ list.scrollTop += d; await new Promise(r=>requestAnimationFrame(r)); }
    await new Promise(r=>setTimeout(r,400));
    const jitterFlips=flips;
    /* now a deliberate, sustained scroll — the header SHOULD retract for this */
    for(let i=0;i<25;i++){ list.scrollTop += 22; await new Promise(r=>requestAnimationFrame(r)); }
    await new Promise(r=>setTimeout(r,400));
    const hidAfterRealScroll=ov.classList.contains('nh-hide');
    /* and a sustained scroll back up should bring it back */
    for(let i=0;i<25;i++){ list.scrollTop -= 22; await new Promise(r=>requestAnimationFrame(r)); }
    await new Promise(r=>setTimeout(r,400));
    obs.disconnect();
    return {jitterFlips, total:flips, hidAfterRealScroll,
            backAfterScrollUp:!ov.classList.contains('nh-hide'),
            card:!!document.querySelector('.notif-group') &&
                 getComputedStyle(document.querySelector('.notif-group')).backgroundColor};
  });
  ok(r!==null,'the notifications list is on screen');
  ok(r.jitterFlips<=1, 'a wobbling finger does not flap the header open and shut',
     r.jitterFlips+' state changes during the jitter');
  ok(r.hidAfterRealScroll, 'a deliberate scroll down still retracts it');
  ok(r.backAfterScrollUp, 'and scrolling back up brings it back');
  /* the founder asked for the grey card to go — rows sit straight on the page again */
  ok(r.card==='rgba(0, 0, 0, 0)', 'the rows sit on the page, not in a grey card', 'card bg '+r.card);
  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
