/* The Account card is Help & feedback and holds only that; everything the app's own
   options card used to hold is still reachable, from Settings; and the Settings search
   bar now moves with the page instead of sitting still. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,320):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='hf'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin) VALUES ('H',$1,$2,$3,true,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1600);

  const card = await p.evaluate(()=>{
    const r=[...document.querySelectorAll('#acMeBody .me-row')].find(e=>/help & feedback/i.test(e.textContent||''));
    return r?{label:(r.textContent||'').trim(), run:r.getAttribute('onclick')}:null;
  });
  ok(!!card, 'the Account page has a Help & feedback card');
  ok(card && card.label==='Help & feedback', 'named exactly that, with a plain ampersand', card&&card.label);
  ok(card && /acMeSection\('app'\)/.test(card.run), 'and it opens the section', card&&card.run);
  const none = await p.evaluate(()=>[...document.querySelectorAll('#acMeBody .me-row')].some(e=>/app & help/i.test(e.textContent||'')));
  ok(none===false, 'and "App & help" is gone from the Account page');

  const sec = await p.evaluate(async()=>{
    acMeSection('app'); await new Promise(r=>setTimeout(r,600));
    const body=document.getElementById('acMeBody');
    return {title:(body.querySelector('.me-sectitle')||{}).textContent||'',
      rows:[...body.querySelectorAll('.me-group .me-row')].map(e=>(e.textContent||'').trim())};
  });
  ok(/help & feedback/i.test(sec.title), 'the section header says Help & feedback', sec.title);
  ok(sec.rows.length===2 && sec.rows.includes('Help') && sec.rows.includes('Send feedback'),
     'and it holds only Help and Send feedback', JSON.stringify(sec.rows));

  // nothing was lost — every moved destination is still reachable and still searchable
  const moved = await p.evaluate(()=>{
    const find=(q,label)=>(acFindPlaces(q,10)||[]).some(x=>new RegExp('^'+label,'i').test(x.label));
    return { whatsNew:find('whats new','What'), history:find('posts you have read','Posts'),
             askData:find('ask about your data','Ask about'), devices:find('devices','Devices'),
             notifs:find('notifications','Notifications') };
  });
  Object.entries(moved).forEach(([k,v])=>ok(v, '  still findable in search: '+k));

  // the Settings search bar moves with the page
  await p.evaluate(()=>{acGoProfileHub();openSettings();}); await p.waitForTimeout(1300);
  const anim = await p.evaluate(async()=>{
    const bar=document.getElementById('setSearchBar'); if(!bar) return null;
    setNav('privacy'); await new Promise(r=>setTimeout(r,600));
    const hiddenOnSub = getComputedStyle(bar).display==='none';
    setBack(); await new Promise(r=>requestAnimationFrame(r));
    const cs=getComputedStyle(bar);
    const bodyAnim=getComputedStyle(document.querySelector('.iset-body[data-page="hub"]')).animationName;
    return {hiddenOnSub, name:cs.animationName, dur:cs.animationDuration, bodyAnim};
  });
  ok(!!anim, 'the settings search bar exists');
  ok(anim.hiddenOnSub, 'it is hidden on a sub-page');
  ok(anim.name==='isetSlideBack', 'coming back, it slides in with the page instead of sitting still', anim.name);
  ok(anim.name===anim.bodyAnim, 'the same animation the page itself uses', anim.name+' vs '+anim.bodyAnim);
  ok(anim.dur==='0.36s', 'and the same duration', anim.dur);

  ok(errs.length===0,'no JS errors',errs.join(' | '));
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
