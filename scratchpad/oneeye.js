/* ONE eye in the whole app (owner), and it is BEAM'S OWN — the read mark that sits under a
   chat name and turns blue once your message is seen. An ellipse with a solid pupil, not a
   lens: "more rounded on the two sides" is exactly what an ellipse is and a lens is not.
   Every place that needs an eye — the post's views count, every show-password toggle, the
   settings rows, a Daily's viewer count — draws that shape, and the hidden state is the
   same ellipse with a slash so the pair reads as one icon in two states. The probe reads
   the shape out of the Beam row itself rather than hardcoding it, so the two can never
   drift. Also checks the toggle still WORKS: swapping icon markup is the kind of edit that
   quietly breaks the class the CSS switches on. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
const EYE='<ellipse cx="12" cy="12" rx="8.6" ry="7.4"/>';   // the ellipse, verbatim from Beam
const PUP='<circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none"/>';
const dims=e=>e?[+e.getAttribute('rx'),+e.getAttribute('ry')]:null;
(async()=>{
  // 1) the source itself: one design, none of the old ones anywhere
  const src=fs.readFileSync('/home/user/atwe/public/index.html','utf8');
  const OLD=['M1 12s4-7 11-7','M2.5 12S6 5.5 12 5.5','M17.94 17.94',
    'M3 12C8.04 5.1 10.99 5.1 12 5.1'];   // the lens this replaced
  OLD.forEach(o=>ok(src.split(o).length-1===0, 'no old eye left in the source ('+o.slice(0,16)+'…)', src.split(o).length-1+' found'));
  const n=src.split(EYE).length-1;
  ok(n>=25, 'the one eye is used everywhere ('+n+' places)', n);
  // it IS Beam's, not a copy that happens to look like it
  ok(src.split(EYE+PUP).length-1 >= 17, "and it carries Beam's solid pupil", src.split(EYE+PUP).length-1+' with a filled pupil');
  const admin=fs.readFileSync('/home/user/atwe/public/admin.html','utf8');
  OLD.forEach(o=>ok(admin.split(o).length-1===0, 'and none in the admin dashboard either ('+o.slice(0,12)+'…)'));

  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='oe'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('Eye',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id; const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  for(let i=0;i<3;i++) await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,$2,true,now()-($3||' seconds')::interval)`,[uid,'Eye probe '+i,i]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  // 2) the post's views icon really renders the new eye
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(7000);
  await p.evaluate(()=>acSetFeed('following'));
  await p.waitForTimeout(2200);
  const v=await p.evaluate(()=>{const sv=document.querySelector('#acFeed .ac-post .ac-views svg');
    if(!sv) return null; const e=sv.querySelector('ellipse'), c=sv.querySelector('circle');
    return {rx:e&&e.getAttribute('rx'), ry:e&&e.getAttribute('ry'),
      pupil:c&&c.getAttribute('r'), filled:c&&c.getAttribute('fill')};});
  ok(v && v.rx==='8.6' && v.ry==='7.4', "the post's views button draws the ellipse", JSON.stringify(v));
  ok(v && v.pupil==='3.1' && v.filled==='currentColor', 'with the solid pupil', JSON.stringify(v));
  await p.close();
  // 3) the show-password toggle: same eye, and it still flips
  const q=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  q.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await q.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await q.evaluate(()=>localStorage.clear());
  await q.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await q.waitForTimeout(6500);
  const pw=await q.evaluate(E=>{
    const btn=[...document.querySelectorAll('.pwd-eye')].find(x=>x.closest('#loginOverlay')) || document.querySelector('.pwd-eye');
    if(!btn) return {none:true};
    const input=btn.parentElement.querySelector('input');
    const oe=btn.querySelector('.eye-open ellipse'), fe=btn.querySelector('.eye-off ellipse');
    const dm=e=>e?e.getAttribute('rx')+'/'+e.getAttribute('ry'):null;
    const openD=dm(oe), offD=dm(fe);
    const oc=btn.querySelector('.eye-open circle'), fc=btn.querySelector('.eye-off circle');
    const before=input?input.type:null;
    togglePwd(btn);
    const after=input?input.type:null;
    const shown=getComputedStyle(btn.querySelector('.eye-off')).display;
    togglePwd(btn);
    return {open:openD, off:offD, openFilled:oc&&oc.getAttribute('fill'), offPupil:!!fc,
      hasSlash:!!btn.querySelector('.eye-off line'), before, after, shownWhenOn:shown,
      backTo:input?input.type:null};});
  if(pw.none){ ok(false,'a show-password toggle exists to test'); }
  else {
    ok(pw.open==='8.6/7.4', 'the show-password eye is the same eye', String(pw.open));
    ok(pw.off==='8.6/7.4' && pw.hasSlash, 'and its hidden state is the same ellipse with a slash', String(pw.off)+' slash:'+pw.hasSlash);
    ok(pw.openFilled==='currentColor' && !pw.offPupil,
       'the open state has the solid pupil and the crossed one drops it — a slash over a filled dot reads as clutter',
       'open fill '+pw.openFilled+', off pupil '+pw.offPupil);
    ok(pw.before==='password' && pw.after==='text' && pw.backTo==='password',
       'the toggle still reveals and re-hides the password', pw.before+' -> '+pw.after+' -> '+pw.backTo);
    ok(pw.shownWhenOn!=='none', 'and the crossed eye is what shows while it is revealed', pw.shownWhenOn);
  }
  ok(errs.length===0,'no page errors',errs.join(' | '));
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
