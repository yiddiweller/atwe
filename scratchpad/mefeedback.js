/* Help & feedback opens as a real section from its own card, and Send feedback opens the
   feedback sheet that already existed and really posts. Renamed from App & help when the
   app's own options moved into Settings — it now holds ONLY help and feedback. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='fb'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('F',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const token=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),uid]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1500);

  // Help & feedback is NOT a row in the sections card
  const inSections = await p.evaluate(()=>{
    const secs=document.querySelector('#acMeBody .me-group');
    return [...secs.querySelectorAll('.me-sec')].some(e=>/help *& *feedback/i.test(e.textContent||''));
  });
  ok(inSections===false, 'Help & feedback is no longer a row inside the sections card');

  // tapping its own card opens the section
  const opened = await p.evaluate(async()=>{
    const r=[...document.querySelectorAll('#acMeBody .me-row')].find(e=>/^Help & feedback$/.test((e.textContent||'').trim()));
    if(!r) return {found:false};
    r.click(); await new Promise(x=>setTimeout(x,700));
    const body=document.getElementById('acMeBody');
    return {found:true, head:(body.querySelector('.me-sectitle')||{}).textContent||'',
      rows:[...body.querySelectorAll('.me-group .me-row')].map(e=>(e.textContent||'').trim())};
  });
  ok(opened.found, 'its own card is on the hub');
  ok(/help.*feedback/i.test(opened.head), 'tapping it opens the Help & feedback section', opened.head);
  ok((opened.rows||[]).some(r=>/^Send feedback$/.test(r)), 'which has a Send feedback row', JSON.stringify(opened.rows));
  /* ONLY help and feedback live here now — the whole point of the rename. If an app
     option creeps back in, this fails rather than quietly growing a junk drawer again. */
  const want=['Help','Send feedback'];
  ok(JSON.stringify((opened.rows||[]).slice().sort())===JSON.stringify(want.slice().sort()),
     'and holds nothing but help and feedback', JSON.stringify(opened.rows));

  // Send feedback opens the sheet that already existed, and it really posts
  const sent = await p.evaluate(async()=>{
    const r=[...document.querySelectorAll('#acMeBody .me-row')].find(e=>/^Send feedback$/.test((e.textContent||'').trim()));
    if(!r) return {found:false};
    r.click(); await new Promise(x=>setTimeout(x,700));
    const v=document.getElementById('feedbackView');
    const open = !!(v && !v.classList.contains('hidden'));
    if(!open) return {found:true, open:false};
    document.getElementById('fbBody').value = 'probe: the account page feedback row works';
    await acSubmitFeedback();
    await new Promise(x=>setTimeout(x,900));
    return {found:true, open:true, closed:document.getElementById('feedbackView').classList.contains('hidden')};
  });
  ok(sent.open, 'it opens the existing feedback sheet', JSON.stringify(sent));
  ok(sent.closed, 'and sending closes it', JSON.stringify(sent));
  const {rows:sup}=await pool.query(`SELECT message,category FROM support_requests WHERE user_id=$1`,[uid]);
  ok(sup.length===1 && /probe: the account page/.test(sup[0].message),
     'the feedback really landed in the support inbox', JSON.stringify(sup));

  // still searchable
  const found = await p.evaluate(()=>(acFindPlaces('feedback',8)||[]).map(x=>x.label+' | '+x.sub));
  ok(found.some(x=>/^Send feedback/.test(x)), 'and search finds it', JSON.stringify(found));
  ok(errs.length===0,'no JS errors',errs.join(' | '));
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
