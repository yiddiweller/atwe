/* The five post actions must read as ONE set: the same visual size and the same stroke.
   Fitting a common BOX is not enough — a wide flat glyph like the eye fills its box in one
   direction only and still looks small — so the measure is the geometric mean sqrt(w*h) of
   each glyph's geometry box, and the stroke is measured ON SCREEN (a scaled glyph needs a
   compensated stroke-width, and forgetting that is exactly how a set drifts). */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
const PROBE=(sel)=>{
  const row=document.querySelector(sel); if(!row) return null;
  return [...row.children].map(btn=>{
    const svg=btn.querySelector('svg'); if(!svg) return null;
    const bb=svg.getBBox();                       // final geometry, transforms included
    /* ellipse FIRST: the eye's outline is an <ellipse> and its pupil is a <circle>, so a
       selector without it silently measures the pupil — or, if the pupil carries
       stroke="none", skips the icon entirely and the check quietly stops covering it. */
    const shape=svg.querySelector('ellipse,path,polyline,circle');
    const ctm=shape.getScreenCTM();
    const scale=Math.hypot(ctm.a,ctm.b);
    const sw=parseFloat(getComputedStyle(shape).strokeWidth);
    return {cls:btn.className.split(' ')[0],
      w:+bb.width.toFixed(2), h:+bb.height.toFixed(2),
      mass:+Math.sqrt(bb.width*bb.height).toFixed(2),
      strokePx:+(sw*scale).toFixed(2), rawSW:sw, scale:+scale.toFixed(4),
      tag:shape.tagName, gsw:(svg.querySelector('g')||{}).getAttribute?svg.querySelector('g').getAttribute('stroke-width'):null};}).filter(Boolean);};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='is'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('Icons',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id; const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  const {rows:pr}=await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,'Icon probe',true,now()) RETURNING id`,[uid]);
  await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,'Second',true,now()-interval '4 seconds')`,[uid]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(7000);
  await p.evaluate(()=>acSetFeed('following'));
  await p.waitForTimeout(2500);
  const check=(where,r)=>{
    if(!r||!r.length){ ok(false, where+': an action row is on screen'); return; }
    r.forEach(o=>console.log('     '+o.cls.padEnd(14)+' box '+String(o.w).padStart(6)+' x '+String(o.h).padStart(6)+'   size '+String(o.mass).padStart(6)+'   stroke '+o.strokePx+'px'));
    const m0=r[0].mass;
    ok(r.every(o=>Math.abs(o.mass-m0)/m0 < 0.06), where+': every icon is the same visual size (~'+m0+')',
       JSON.stringify(r.map(o=>o.cls+':'+o.mass)));
    const s0=r[0].strokePx;
    ok(r.every(o=>Math.abs(o.strokePx-s0)<0.06), where+': and every one is drawn with the same stroke ('+s0+'px)',
       JSON.stringify(r.map(o=>o.cls+':'+o.strokePx)));
    ok(s0>1.05, where+': the stroke is the heavier one, not the old thin line', s0+'px on screen');};
  check('feed', await p.evaluate(PROBE,'#acFeed .ac-post .ac-post-actions'));
  await p.evaluate(id=>acOpenPostView(id), pr[0].id);
  await p.waitForTimeout(2500);
  check('post page', await p.evaluate(PROBE,'.ac-postfocus .ac-pf-actions'));
  ok(errs.length===0,'no page errors',errs.join(' | '));
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
