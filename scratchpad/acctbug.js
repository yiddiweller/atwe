/* "Sometimes when I click Account it pops back to Engine." Try every route into
   Account, from every other world, on phone and desktop, and report which one
   leaves the wrong tab lit. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let bad=0, runs=0;
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='ab'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,balance_cents) VALUES ('A',$1,$2,$3,true,true,5000) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  await pool.query("INSERT INTO notifications (user_id,actor_id,type,created_at) VALUES ($1,$1,'follow',now())",[rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  for (const [w,hh,tag,pre] of [[390,844,'phone','bnav-'],[1440,900,'desktop','snav-']]) {
    const p=await b.newPage({viewport:{width:w,height:hh}});
    const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(4500);
    const lit = () => p.evaluate((pr)=>{
      const on=['home','chat','search','notifs','profile'].filter(t=>document.getElementById(pr+t)?.classList.contains('active'));
      return { on, appTab: (typeof _appTab!=='undefined'?_appTab:'?'), path: location.pathname };
    }, pre);
    // from every other world, and from the AI page, click Account
    const froms = [['Home',"appTab('home')"],['Beam',"appTab('chat')"],['Engine',"appTab('search')"],
                   ['Atwe AI',"appTab('ai')"],['Notifications','acNavNotifs()'],['Account again',"appTab('profile')"]];
    for (const [name, go] of froms) {
      await p.evaluate((c)=>{ try{ new Function(c)(); }catch(e){} }, go);
      await p.waitForTimeout(1300);
      /* Atwe AI is an INSIDE page now: it deliberately has no bottom bar, so on a phone
         the way out is its back arrow, not a bar button. Clicking the (hidden) bar used
         to be this probe's route and silently left it stranded on /ai, which then made
         every LATER case fail too — one changed behaviour reported as six failures.
         On desktop the sidebar is still there, so nothing changes. */
      const onAiNoBar = tag === 'phone' && await p.evaluate(() =>
        location.pathname === '/ai' && getComputedStyle(document.getElementById('bottomNav')).display === 'none');
      if (onAiNoBar) { await p.click('#tbAiBack'); await p.waitForTimeout(1400); }
      await p.click('#'+pre+'profile').catch(()=>{});
      await p.waitForTimeout(1600);
      const r = await lit(); runs++;
      const okNow = r.on.length===1 && r.on[0]==='profile';
      if (!okNow) { bad++; console.log(`  ✗ ${tag}: Account from ${name} -> lit ${JSON.stringify(r.on)} (_appTab=${r.appTab}, ${r.path})`); }
      else console.log(`  ok ${tag}: Account from ${name}`);
      // and again after a moment, in case something re-syncs late
      await p.waitForTimeout(1500);
      const r2 = await lit();
      if (!(r2.on.length===1 && r2.on[0]==='profile')) { bad++; console.log(`  ✗ ${tag}: ...then DRIFTED to ${JSON.stringify(r2.on)} (_appTab=${r2.appTab})`); }
    }
    if (errs.length) console.log('  js errors:', errs[0]);
    await p.close();
  }
  await b.close(); await pool.end();
  console.log(`\n${runs} routes tried, ${bad} wrong`);
})().catch(e=>{console.error('CRASH',e.message);process.exit(2);});
