/* Build 1751 — the four trims the founder asked for, each proved by driving the real UI:
     · the profile popover has no Downgrade / Settings / Help, and its plan row is a blue
       Upgrade that a Pro account never sees;
     · leaving Pro is still possible — it moved to the Standard card in the plans sheet,
       because a menu with no way to cancel a subscription is not an option;
     · the drawer has no "Profile" row on a phone (but keeps it on desktop, where it is
       the only route to Add account / Log out);
     · the floating nav pill no longer slices through the open drawer.
   The nav check compares PAINT ORDER, not z-index: the drawer is inside #app (a stacking
   context at z-index 1), so its own 200 can never beat a body-level nav at 120 — reading
   the numbers would say "the drawer is higher" while the screen says otherwise. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};

(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='pm'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,plan)
      VALUES ('Menu Tester',$1,$2,$3,true,true,'free') RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),uid]);

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  const boot=async(p)=>{
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(7000);
  };

  // ── phone ────────────────────────────────────────────────────────────────
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e)));
  await boot(p);

  console.log('\n── the profile popover (free account) ──');
  await p.click('#tbBrandProf');   // the real top-right avatar — NEVER pass document.body as
  // the trigger: _hideMenuSrcBtn sets opacity:0 on it, which blanks the whole screen
  await p.waitForTimeout(600);
  let m=await p.evaluate(()=>{
    const el=document.getElementById('profileMenu');
    const rows=[...el.querySelectorAll('.pm-item')].filter(r=>getComputedStyle(r).display!=='none')
      .map(r=>(r.innerText||'').trim());
    return {hidden:el.classList.contains('hidden'),rows};
  });
  ok(!m.hidden,'the menu opens');
  console.log('     rows: '+JSON.stringify(m.rows));
  ok(!m.rows.some(r=>/downgrade/i.test(r)),'no Downgrade row');
  ok(!m.rows.some(r=>/^settings$/i.test(r)),'no Settings row');
  ok(!m.rows.some(r=>/^help$/i.test(r)),'no Help row');
  ok(m.rows.some(r=>/add account/i.test(r)),'Add account is still there');
  ok(m.rows.some(r=>/log out/i.test(r)),'Log out is still there');
  ok(m.rows.some(r=>/upgrade to pro/i.test(r)),'a free account is offered Upgrade to Pro');
  const blue=await p.evaluate(()=>{
    const el=document.getElementById('pmPlanItem');
    const acc=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return {c:getComputedStyle(el).color,acc};
  });
  ok(/0,\s*136,\s*255/.test(blue.c),'and it is blue',blue.c);

  console.log('\n── the same popover on a Pro account ──');
  await p.evaluate(()=>{closeProfileMenu();S.plan='pro';});
  await p.waitForTimeout(400);
  await p.click('#tbBrandProf');
  await p.waitForTimeout(600);
  m=await p.evaluate(()=>[...document.querySelectorAll('#profileMenu .pm-item')]
    .filter(r=>getComputedStyle(r).display!=='none').map(r=>(r.innerText||'').trim()));
  console.log('     rows: '+JSON.stringify(m));
  ok(!m.some(r=>/upgrade|downgrade/i.test(r)),'no plan row at all — nothing for them to do here');
  ok(m.some(r=>/add account/i.test(r))&&m.some(r=>/log out/i.test(r)),'the other rows survive');

  console.log('\n── leaving Pro is still reachable ──');
  await p.evaluate(()=>{closeProfileMenu();openPlans();});
  await p.waitForTimeout(700);
  let pl=await p.evaluate(()=>({free:document.getElementById('planFreeBtn').textContent.trim(),
    pro:document.getElementById('planProBtn').textContent.trim(),
    proCur:document.getElementById('planProBtn').classList.contains('is-current')}));
  ok(/switch to free/i.test(pl.free),'on Pro, the Standard card offers Switch to Free',pl.free);
  ok(/your current plan/i.test(pl.pro)&&pl.proCur,'and the Pro card becomes a quiet label',pl.pro);
  const loud=await p.evaluate(()=>getComputedStyle(document.getElementById('planProBtn')).backgroundColor);
  ok(/rgba\(0, 0, 0, 0\)|transparent/.test(loud),'the Pro button stops shouting in blue once it is yours',loud);
  await p.evaluate(()=>{S.plan='free';openPlans();});
  await p.waitForTimeout(500);
  pl=await p.evaluate(()=>({free:document.getElementById('planFreeBtn').textContent.trim(),
    pro:document.getElementById('planProBtn').textContent.trim()}));
  ok(/your current plan/i.test(pl.free)&&/get atwe pro/i.test(pl.pro),'and it reads the normal way round on Free');
  await p.evaluate(()=>closePlans());
  await p.waitForTimeout(400);

  console.log('\n── the drawer on a phone ──');
  await p.evaluate(()=>toggleSidebar());
  await p.waitForTimeout(700);
  const sb=await p.evaluate(()=>{
    const row=document.getElementById('sbProfile');
    return {shown:!!row&&getComputedStyle(row).display!=='none',
      rows:[...document.querySelectorAll('.sb-user > *')].filter(r=>getComputedStyle(r).display!=='none')
        .map(r=>(r.innerText||'').trim().split('\n')[0])};
  });
  console.log('     footer rows: '+JSON.stringify(sb.rows));
  ok(!sb.shown,'no "Profile" row in the drawer');
  /* Settings is deliberately NOT here any more (build 1754): the gear row became Account,
     with Help & feedback under it, and Settings moved one tap in to the Account page's own
     Settings card. What this guards is that removing the Profile row did not leave the
     footer with nothing — there is still a way into the account area from the drawer. */
  ok(sb.rows.some(r=>/^account$/i.test(r)),'and the footer still opens the account area',
     JSON.stringify(sb.rows));
  ok(sb.rows.some(r=>/^settings$/i.test(r)),'and Settings, which the owner asked back (build 1757)');

  /* Paint order, not z-index. Sample a pixel where the nav pill and the drawer overlap
     and ask what is actually on screen. elementFromPoint answers with the top HIT
     target, which is the honest question here — the nav pill is opaque and clickable, so
     if it is painted over the drawer it is also what a finger would hit. */
  const over=await p.evaluate(()=>{
    const nav=document.getElementById('bottomNav'), r=nav.getBoundingClientRect();
    const x=r.left+18, y=r.top+r.height/2;      // inside the pill AND inside the drawer
    const el=document.elementFromPoint(x,y);
    return {inNav:!!(el&&el.closest('#bottomNav')),inSb:!!(el&&el.closest('#sidebar')),
      tag:el?(el.id||el.className||el.tagName):'none',
      navZ:getComputedStyle(nav).zIndex, cls:document.body.classList.contains('sb-open')};
  });
  ok(over.cls,'body carries .sb-open while the drawer is open');
  ok(over.navZ==='0','and the nav pill drops below #app',  'z-index '+over.navZ);
  ok(!over.inNav,'the nav pill no longer sits on top of the drawer','hit: '+over.tag);
  ok(over.inSb,'the drawer is what you actually touch there');

  await p.evaluate(()=>closeSidebar());
  await p.waitForTimeout(700);
  const back=await p.evaluate(()=>{
    const nav=document.getElementById('bottomNav'), r=nav.getBoundingClientRect();
    const el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {z:getComputedStyle(nav).zIndex,inNav:!!(el&&el.closest('#bottomNav')),
      cls:document.body.classList.contains('sb-open')};
  });
  ok(!back.cls&&back.z!=='0','closing the drawer puts the nav back',  'z-index '+back.z);
  ok(back.inNav,'and it is tappable again');

  console.log('\n── Add account still opens where you can see it ──');
  await p.click('#tbBrandProf');
  await p.waitForTimeout(500);
  await p.evaluate(()=>openAddAccount({stopPropagation(){}}));
  await p.waitForTimeout(600);
  const aa=await p.evaluate(()=>{const r=document.getElementById('addAcctMenu').getBoundingClientRect();
    return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width)};});
  // The row it anchors to is hidden on phones; a hidden element still HAS a rect, an
  // all-zero one, so without the width check the chooser lands in the top-left corner.
  ok(aa.x>=8&&aa.y>60&&aa.w>=200,'the chooser is on screen, not pinned to the corner',
     JSON.stringify(aa));
  await p.evaluate(()=>{closeAddAccount&&closeAddAccount();closeProfileMenu();});

  // ── desktop keeps the row ────────────────────────────────────────────────
  console.log('\n── desktop ──');
  const d=await b.newPage({viewport:{width:1280,height:900}});
  d.on('pageerror',e=>errs.push(String(e)));
  await boot(d);
  const dr=await d.evaluate(()=>{const r=document.getElementById('sbProfile');
    return !!r&&getComputedStyle(r).display!=='none';});
  ok(dr,'the sidebar keeps its account row on a computer — it is the only Log out there');
  await d.close();

  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
