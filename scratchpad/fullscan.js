/* A whole-app scan: walk a real signed-in account through every world and most of
   the panels behind them, at phone and desktop, in both themes, watching for
   THREE things the visual probes do not look for —
     · any uncaught JS error,
     · any request that fails (excluding the ones we deliberately expect),
     · any surface that renders with nothing on it.
   Nothing here asserts a design; it is looking for things that are broken. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const problems=[];
const ok=(c,m,d)=>{c?pass++:fail++;if(!c)problems.push(m+(d?' — '+d:''));
  console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};

// every world, and the panels a member actually opens
const SURFACES = [
  ['Home feed',            "appTab('home')"],
  ['Following',            "acSetFeed('following')"],
  ['Circles feed',         "acSetFeed('circles')"],
  ['Collections',          "acSetFeed('collections')"],
  ['Beam',                 "appTab('chat')"],
  ['Beam · calls',         "acChatsTab('calls')"],
  ['Beam · contacts',      "acChatsTab('contacts')"],
  ['Engine',               "appTab('search')"],
  ['Notifications',        "acNavNotifs()"],
  ['Account hub',          "appTab('profile')"],
  ['Atwe AI',              "appTab('ai')"],
  ['Settings',             "openSettings()"],
  ['Wallet',               "acOpenWallet()"],
  ['Orders',               "acOpenOrders('buyer')"],
  ['Marketplace',          "acOpenMarketplace()"],
  ['Jobs board',           "acGoJobsBoard('jobs')"],
  ['Find workers',         "acGoJobsBoard('workers')"],
  ['Events',               "acOpenEvents()"],
  ['Courses',              "acOpenCourses()"],
  ['Communities',          "acOpenCommunities()"],
  ['Services',             "acOpenServices()"],
  ['Businesses',           "acOpenDirectory()"],
  ['Newsletters',          "acOpenNewsletters()"],
  ['Showcase',             "acOpenShowcaseDiscover()"],
  ['Gift cards',           "acOpenGiftCards()"],
  ['Invoices',             "acOpenInvoices()"],
  ['Quotes',               "acOpenQuotes()"],
  ['Appointments',         "acOpenAppointments()"],
  ['Bookings',             "acOpenBookings()"],
  ['Rewards',              "acOpenLoyalty()"],
  ['Referrals',            "acOpenReferrals()"],
  ['Dashboard',            "acOpenDashboard()"],
  ['Own profile',          "acGoProfile()"],
];

(async()=>{
  const mk=async(name,biz)=>{const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
    const u='sc'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,account_type,verified,plan)
      VALUES ($1,$2,$3,$4,true,true,$5,true,'pro') RETURNING id`,[name,e,h,u,biz?'business':'personal']);
    return {id:rows[0].id,u,e};};
  const me=await mk('Scan Tester',true), other=await mk('Someone Else',false);
  const t=auth.signToken({id:me.id,email:me.e,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),me.id]);
  await pool.query('INSERT INTO follows (follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[me.id,other.id]);
  await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,'A post to scan against.',true,now())`,[other.id]);
  await pool.query(`INSERT INTO at_messages (sender_id,recipient_id,body,created_at) VALUES ($1,$2,'hello',now())`,[other.id,me.id]);

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  for (const [label,w,theme] of [['phone',390,'black'],['phone',390,'light'],['desktop',1400,'black']]){
    console.log('\n══ '+label+' '+w+'px · '+theme+' ══');
    const errs=[], bad=[];
    const p=await b.newPage({viewport:{width:w,height:900},deviceScaleFactor:2,hasTouch:w<800,isMobile:w<800});
    p.on('pageerror',e=>errs.push(String(e).slice(0,150)));
    p.on('console',m=>{ if(m.type()==='error'){ const x=m.text();
      // a failed fetch already shows up as a response event; ignore the duplicate
      if(!/Failed to load resource|net::ERR/i.test(x)) errs.push('console: '+x.slice(0,150)); }});
    p.on('response',r=>{ const u=r.url(), s=r.status();
      if(s>=500) bad.push(s+' '+u.replace('http://localhost:3262',''));
      // 404 on an optional integration is expected; a 404 on an app route is not
      else if(s===404 && /\/api\//.test(u) && !/\/api\/(stt|gif|quote)/.test(u)) bad.push(s+' '+u.replace('http://localhost:3262',''));
    });
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
      localStorage.setItem('atwe_theme',th);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(7500);
    let blank=[];
    for (const [name,call] of SURFACES){
      const known=await p.evaluate(c=>{const n=c.split(/[^A-Za-z0-9_$]/)[0];
        return typeof window[n]==='function';}, call);
      if(!known){ errs.push('"'+name+'": '+call.split('(')[0]+' does not exist'); continue; }
      try { await p.evaluate(c=>{ try{ eval(c); }catch(e){ throw new Error(c+' :: '+e.message); } }, call); }
      catch(e){ errs.push('open "'+name+'": '+String(e.message).slice(0,120)); continue; }
      await p.waitForTimeout(950);
      const txt=await p.evaluate(()=>(document.body.innerText||'').trim().length);
      if (txt < 3) blank.push(name);
      // leave every panel the way we found it
      await p.evaluate(()=>{ try{ document.querySelectorAll('.overlay:not(.hidden)').forEach(o=>{
        if(o.id && typeof closeOverlay==='function') closeOverlay(o.id, true); }); }catch(e){} });
      await p.waitForTimeout(120);
    }
    ok(blank.length===0, label+' '+theme+': every surface rendered something', blank.join(', ')||'0 blank');
    ok(errs.length===0, label+' '+theme+': no JS errors across '+SURFACES.length+' surfaces',
       errs.slice(0,3).join(' | ')||'0');
    ok(bad.length===0, label+' '+theme+': no failed requests', [...new Set(bad)].slice(0,4).join(' | ')||'0');
    await p.close();
  }
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  if (problems.length){ console.log('\nPROBLEMS:'); problems.forEach(x=>console.log(' · '+x)); }
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
