/* The extra bottom clearance is for the FLOATING phone nav pill. Desktop uses the
   sidebar and has no bottom bar, so it must NOT inherit the padding. */
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
  const h='dk'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin) VALUES ('D',$1,$2,$3,true,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:1440,height:900}});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1500);
  const r = await p.evaluate(async()=>{
    const body=document.getElementById('acMeBody');
    const nav=document.getElementById('bottomNav');
    const sc = document.body.classList.contains('pgscroll') ? (document.scrollingElement||document.documentElement) : body;
    for(let i=0;i<3;i++){ sc.scrollTop=sc.scrollHeight; window.dispatchEvent(new Event('scroll')); await new Promise(r=>setTimeout(r,600)); }
    const out=[...body.querySelectorAll('.me-row')].find(e=>/log out/i.test(e.textContent));
    const q=out?out.getBoundingClientRect():null;
    return { padBottom:getComputedStyle(body).paddingBottom,
      navHidden:getComputedStyle(nav).display==='none',
      sidebar: !!document.querySelector('.sidebar') && getComputedStyle(document.querySelector('.sidebar')).display!=='none',
      logoutBottom:q?Math.round(q.bottom):null, vh:innerHeight,
      admin: [...body.querySelectorAll('.me-row')].some(e=>/admin dashboard/i.test(e.textContent)) };
  });
  console.log('  '+JSON.stringify(r));
  ok(r.navHidden, 'desktop has no floating bottom bar');
  ok(r.padBottom==='40px', 'so the Account page keeps its plain 40px bottom padding', 'got '+r.padBottom);
  ok(r.logoutBottom!==null && r.logoutBottom <= r.vh, 'Log out is on screen at the bottom', 'bottom '+r.logoutBottom+' vs '+r.vh);
  ok(r.admin, 'the Admin dashboard row is there on desktop too');
  ok(errs.length===0,'no JS errors',errs[0]);
  await p.screenshot({path:SP+'icons/ACC-desktop.png'});
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
