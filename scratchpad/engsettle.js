/* The Engine (Explore) page must not visibly rearrange after it opens.
   Measured before the fix: 724px on the first frame, 1298px 100ms later — three
   blocks landing from three separate requests. A returning visitor must now see the
   finished page immediately. The FIRST ever visit is allowed to settle once (there is
   nothing remembered yet), so the probe opens Engine twice and judges the second. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,400):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='es'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('E',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const token=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),uid]);
  const {rows:others}=await pool.query(`SELECT id,username FROM users WHERE username IS NOT NULL AND id<>$1 LIMIT 3`,[uid]);
  for (const o of others) await pool.query(`INSERT INTO recent_views (user_id,kind,ref_id) VALUES ($1,'profile',$2) ON CONFLICT DO NOTHING`,[uid,o.id]).catch(()=>{});
  await pool.query(`INSERT INTO search_history (user_id,q) VALUES ($1,'water'),($1,'hidd'),($1,'atwe')`,[uid]).catch(()=>{});
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(([t,us])=>{localStorage.clear();localStorage.setItem('atwe_token',t);
    localStorage.setItem('atwe_recent_profiles',JSON.stringify(us.map(u=>({username:u,name:u,avatar:null}))));
    localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[token,others.map(o=>o.username)]);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);

  const visit = async () => {
    await p.evaluate(()=>appTab('home')); await p.waitForTimeout(900);
    return await p.evaluate(async()=>{
      const H=()=>{const e=document.getElementById('acSearchPageResults');return e?Math.round(e.getBoundingClientRect().height):-1;};
      appTab('search');
      const first=H(); const seen=[first];
      for (let i=0;i<26;i++){ await new Promise(r=>setTimeout(r,100)); seen.push(H()); }
      return {first, last:seen[seen.length-1], max:Math.max(...seen), min:Math.min(...seen), seen};
    });
  };
  const a = await visit();
  console.log('  first visit : opens '+a.first+' → settles '+a.last);
  ok(a.last > 200, 'the Explore page actually has content to measure', JSON.stringify(a).slice(0,200));

  const c = await visit();
  console.log('  return visit: opens '+c.first+' → settles '+c.last+'  (min '+c.min+', max '+c.max+')');
  ok(c.last > 200, 'and still does on the second visit', JSON.stringify(c).slice(0,200));
  ok(Math.abs(c.first - c.last) <= 2,
     'a returning visitor sees the finished page on the FIRST frame — it does not grow',
     'opened at '+c.first+'px and ended at '+c.last+'px');
  ok(c.max - c.min <= 2,
     'and nothing appears or disappears while they look at it',
     'height moved between '+c.min+'px and '+c.max+'px');
  ok(errs.length===0,'no JS errors',errs.join(' | '));
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
