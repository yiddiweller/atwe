process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+String(x).slice(0,220):''));}};
const TYPES=['follow','like','reply','mention','connection','endorse','repost','event_rsvp','qa_answer','team_invite'];
(async()=>{
  const mk=async(pfx)=>{const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
    const h=pfx+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ($4,$1,$2,$3,true,true) RETURNING id`,[email,hash,h,'User '+h.slice(2,6)]);
    return {id:rows[0].id,email,h};};
  const me=await mk('pl');
  const token=auth.signToken({id:me.id,email:me.email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),me.id]);
  for (let i=0;i<24;i++){ const a=await mk('pa');
    await pool.query("INSERT INTO notifications (user_id,actor_id,type,read,created_at) VALUES ($1,$2,$3,false,now() - ($4||' minutes')::interval)",[me.id,a.id,TYPES[i%TYPES.length],i]); }

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);

  // ── 1. the Notifications entry flourish ──
  await p.evaluate(()=>appTab('chat')); await p.waitForTimeout(1500);
  await p.evaluate(()=>appTab('home')); await p.waitForTimeout(1200);
  const roll = await p.evaluate(async()=>{
    const seen={mark:false, word:false, cls:false};
    document.getElementById('bnav-notifs').click();
    for (let i=0;i<40;i++){
      await new Promise(r=>setTimeout(r,20));
      const lk=document.querySelector('#notifHead .tb-brand'); if(!lk) continue;
      if (lk.classList.contains('rolling')) seen.cls=true;
      const m=lk.querySelector('.tb-brand-mark'), w=lk.querySelector('.tb-brand-word-txt');
      if (m && getComputedStyle(m).animationName && getComputedStyle(m).animationName!=='none') seen.mark=getComputedStyle(m).animationName;
      if (w && getComputedStyle(w).animationName && getComputedStyle(w).animationName!=='none') seen.word=getComputedStyle(w).animationName;
    }
    await new Promise(r=>setTimeout(r,900));
    const lk=document.querySelector('#notifHead .tb-brand');
    seen.cleared = !lk.classList.contains('rolling');
    return seen;
  });
  console.log('  roll observed:', JSON.stringify(roll));
  ok(roll.cls, 'landing on Notifications plays the roll (class applied)');
  ok(roll.mark==='tbBrandRoll', 'the swirl runs the SAME roll animation as Beam/Engine', roll.mark);
  ok(roll.word==='tbWordSpit', 'the word spits out to the right, same as Beam/Engine', roll.word);
  ok(roll.cleared, 'and the class is cleared afterwards (or it kills the tab-tap spin)');

  /* ── the header does NOT retract on scroll ──
     It used to, and this line used to assert that it did. Animating its 58px margin-top
     reflows the whole list under the finger, which is what made the page scroll choppily;
     the founder reported it twice. Measured on a throttled CPU it cost 5 dropped frames a
     scroll, against zero with the header still — see scratchpad/notifscroll.js, which owns
     the frame-pacing measurement. What is still checked here is that the page opens
     showing its header, which is what a member sees. */
  const rt = await p.evaluate(async()=>{
    const list=document.getElementById('notifList'), head=document.getElementById('notifHead');
    await new Promise(r=>setTimeout(r,600));
    const before=head.getBoundingClientRect().top;
    list.scrollTop=280; list.dispatchEvent(new Event('scroll'));
    await new Promise(r=>setTimeout(r,600));
    const after=head.getBoundingClientRect().top;
    closeOverlay('notifOverlay'); await new Promise(r=>setTimeout(r,700));
    document.getElementById('bnav-notifs').click(); await new Promise(r=>setTimeout(r,900));
    return {before:+before.toFixed(1), after:+after.toFixed(1),
      reopened:+document.getElementById('notifHead').getBoundingClientRect().top.toFixed(1),
      hid:document.getElementById('notifOverlay').classList.contains('nh-hide')};
  });
  console.log('  retraction:', JSON.stringify(rt));
  ok(Math.abs(rt.after - rt.before) < 2, 'the header stays put while you scroll (that reflow WAS the jank)',
     JSON.stringify(rt));
  ok(!rt.hid, 'and nothing re-introduced the retract class', JSON.stringify(rt));
  ok(!rt.hid && rt.reopened>=0, 'and reopening shows the header again (it used to stay hidden)', JSON.stringify(rt));

  // ── 2. no comets on the AI page ──
  await p.evaluate(()=>{ if(document.body.classList.contains('notif-tab')){document.body.classList.remove('notif-tab');closeOverlay('notifOverlay');} appTab('ai'); });
  await p.waitForTimeout(1800);
  const comets = await p.evaluate(()=>({
    api: typeof window.aiComets, layers: document.querySelectorAll('.ai-comets,.ai-comet').length,
    working: document.querySelectorAll('.ai-working').length }));
  ok(comets.api==='undefined', 'the comet code is gone entirely, not just switched off', 'typeof aiComets = '+comets.api);
  ok(comets.layers===0 && comets.working===0, 'no comet elements anywhere', JSON.stringify(comets));

  // ── 3. no name labels on AI messages ──
  const labels = await p.evaluate(async()=>{
    appendBubble('user','hello there');
    appendBubble('ai','**Step 1:** do the thing');
    await new Promise(r=>setTimeout(r,300));
    const rows=[...document.querySelectorAll('#messages .msg')];
    return { rows:rows.length, senders:document.querySelectorAll('#messages .msg-sender').length,
      text:rows.map(r=>r.innerText.trim().slice(0,40)) };
  });
  console.log('  AI rows:', JSON.stringify(labels));
  ok(labels.rows>=2, 'messages render');
  ok(labels.senders===0, 'no sender label element is emitted', 'found '+labels.senders);
  ok(!labels.text.some(t=>/Atwe AI/.test(t)), 'the reply is not labelled "Atwe AI"', JSON.stringify(labels.text));
  ok(!labels.text.some(t=>t.startsWith('User ')), 'your own message is not labelled with your name', JSON.stringify(labels.text));
  await p.screenshot({path:SP+'icons/AI-clean.png'});

  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
