/* The Settings search bar must travel WITH the page, not sit still while it slides.
   Measures both boxes at the same instants during a back-navigation. */
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
  const h='ss'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('S',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const t=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  await p.evaluate(()=>openSettings()); await p.waitForTimeout(900);

  // sample both boxes across a back-navigation
  const r = await p.evaluate(async()=>{
    const bar=()=>document.getElementById('setSearchBar');
    const panel=()=>document.querySelector('.iset-body[data-page="hub"]');
    setNav('display'); await new Promise(x=>setTimeout(x,500));
    const frames=[];
    setBack();
    for (let i=0;i<7;i++){
      await new Promise(x=>requestAnimationFrame(()=>setTimeout(x,32)));
      const B=bar(), P=panel();
      frames.push({ bar: B?Math.round(B.getBoundingClientRect().left):null,
                    panel: P?Math.round(P.getBoundingClientRect().left):null,
                    barOp: B?+getComputedStyle(B).opacity.slice(0,4):null });
    }
    await new Promise(x=>setTimeout(x,500));
    const B=bar(),P=panel();
    frames.push({bar:Math.round(B.getBoundingClientRect().left), panel:Math.round(P.getBoundingClientRect().left), barOp:+getComputedStyle(B).opacity.slice(0,4)});
    return frames;
  });
  console.log('  frames (left px):');
  r.forEach((f,i)=>console.log('    '+i+'  bar '+String(f.bar).padStart(5)+'   panel '+String(f.panel).padStart(5)+'   bar opacity '+f.barOp));
  const moved = Math.max(...r.map(f=>f.bar)) - Math.min(...r.map(f=>f.bar));
  ok(moved > 20, 'the search bar actually travels during the back-slide', 'moved '+moved+'px');
  /* The bar rests 2px right of the panel — its own `margin:0 2px` — so "in step" means
     that gap never CHANGES, not that the two lefts are equal. Comparing the raw numbers
     called the intended layout a 2px drift. */
  const last=r[r.length-1];
  const rest = last.bar - last.panel;
  const drift = Math.max(...r.map(f=>Math.abs((f.bar - f.panel) - rest)));
  ok(drift <= 2, 'and stays in step with the page it belongs to', 'worst drift '+drift+'px (resting gap '+rest+'px)');
  /* Frame 0 lands wherever the first rAF falls, so it is not a fixed number — assert the
     shape (starts well short of opaque, ends opaque), not a sampled value. */
  const minOp = Math.min(...r.map(f=>f.barOp));
  ok(last.barOp===1 && minOp < 0.5, 'it fades in with the page and settles opaque', JSON.stringify([minOp,last.barOp]));
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
