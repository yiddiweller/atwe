/* The three Account-page changes the owner asked for (build 1719):
   1. "Set a status" moves OFF the hub and into the Profile section, as its own card.
   2. "Admin dashboard" becomes the LAST row inside the sections card — connected to
      them, separate from Log out, which stays its own card below.
   3. Scrolled to the bottom, Log out must clear the floating nav bar with room to spare.
   Every check asserts the thing EXISTS before judging it, so a renamed row fails
   loudly instead of silently skipping (the clicktest lesson). */
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
  const h='ac'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin) VALUES ('A',$1,$2,$3,true,true,true) RETURNING id`,[email,hash,h]);
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

  // ---- 1 + 2 : the hub -----------------------------------------------------
  const hub = await p.evaluate(()=>{
    const body=document.getElementById('acMeBody');
    const groups=[...body.querySelectorAll('.me-group')];
    const txt=e=>(e.textContent||'').replace(/\s+/g,' ').trim();
    const secs=groups[0], tail=groups[1], tail2=groups[2], tail3=groups[3], last=groups[groups.length-1];
    const R=e=>e?e.getBoundingClientRect():null;
    return {
      status: !!body.querySelector('.me-status'),
      groups: groups.length,
      secRows: secs?[...secs.children].map(txt):[],
      secAllSections: secs ? [...secs.children].every(e=>e.classList.contains('me-sec')) : null,
      tailRows: tail?[...tail.children].map(txt):[],
      tail2Rows: tail2?[...tail2.children].map(txt):[],
      tail3Rows: tail3?[...tail3.children].map(txt):[],
      // each single-row card must be a full capsule; the big one must not be
      soloRadius: tail?getComputedStyle(tail).borderTopLeftRadius:null,
      secRadius: secs?getComputedStyle(secs).borderTopLeftRadius:null, postCardR: getComputedStyle(document.documentElement).getPropertyValue('--post-card-r').trim(),
      secHasSubs: secs?secs.querySelectorAll('.me-secsub').length:-1,
      allGaps: groups.slice(0,-1).map((g,i)=>Math.round(R(groups[i+1]).top - R(g).bottom)),
      footRows: last?[...last.children].map(txt):[],
      // a real visible gap between the sections card and the tail card
      gap: (secs&&tail) ? Math.round(R(tail).top - R(secs).bottom) : null,
    };
  });
  console.log('  hub: '+JSON.stringify(hub).slice(0,600));
  ok(hub.groups===5, 'five separate cards: sections, Settings, Help & feedback, Admin, Log out', 'groups='+hub.groups);
  ok(hub.status===false, 'the status card is no longer on the hub');
  ok(hub.secRows.length>0, 'the sections card has rows');
  ok(hub.secAllSections===true, 'the sections card holds ONLY sections \u2014 nothing glued to its bottom',
     JSON.stringify(hub.secRows.slice(-2)));
  ok(hub.tailRows.length===1 && /^Settings$/.test(hub.tailRows[0]||''),
     'Settings is alone in its own card', JSON.stringify(hub.tailRows));
  /* Renamed from "App & help": the app's own options moved into Settings and what is
     left here is only how you get help. Plain '&', not '&amp;' — a tail row goes through
     item() -> escHtml, unlike a section title, which is interpolated raw. */
  ok(hub.tail2Rows.length===1 && /^Help & feedback$/.test(hub.tail2Rows[0]||''),
     'Help & feedback is its own card directly under Settings, with a plain ampersand',
     JSON.stringify(hub.tail2Rows));
  ok(hub.tail3Rows.length===1 && /admin dashboard/i.test(hub.tail3Rows[0]||''),
     'and Admin dashboard is alone in its own card too', JSON.stringify(hub.tail3Rows));
  ok(parseFloat(hub.soloRadius) > 24, 'a single-row card is a full capsule', hub.soloRadius);
  ok(hub.secRadius===hub.postCardR,
     'the big card turns on the very same corner as a post card and the nav bar ('+hub.secRadius+')',
     'card '+hub.secRadius+'  post card '+hub.postCardR);
  ok(hub.secHasSubs===0, 'no subtitles under the section names', 'found '+hub.secHasSubs);
  ok(hub.allGaps.length>0 && new Set(hub.allGaps).size===1,
     'every card is separated by the same gap', JSON.stringify(hub.allGaps));
  ok(hub.gap!==null && hub.gap>=8, 'with a real gap under the sections, so it reads as separate', 'gap '+hub.gap+'px');
  ok(hub.footRows.length===1 && /log out/i.test(hub.footRows[0]||''),
     'Log out is alone in its own card below', JSON.stringify(hub.footRows));

  // ---- 1 : the Profile section --------------------------------------------
  await p.evaluate(()=>acMeSection('profile')); await p.waitForTimeout(700);
  const sec = await p.evaluate(()=>{
    const body=document.getElementById('acMeBody');
    const st=body.querySelector('.me-status');
    const grp=body.querySelector('.me-group');
    return { status:!!st, insideGroup: !!(st && grp && grp.contains(st)),
      beforeGroup: !!(st && grp && (st.compareDocumentPosition(grp) & Node.DOCUMENT_POSITION_FOLLOWING)),
      head: !!body.querySelector('.me-sechead'),
      rows: grp?grp.children.length:0,
      tapOpens: (st&&st.getAttribute('onclick'))||'' };
  });
  console.log('  profile section: '+JSON.stringify(sec));
  ok(sec.head, 'the Profile section opened with its own header');
  ok(sec.status, 'the status card is now in the Profile section');
  ok(sec.insideGroup===false, 'and it is SEPARATE — not one of the rows in the card');
  ok(sec.beforeGroup, 'sitting above the section rows');
  ok(/acStatusOpen/.test(sec.tapOpens), 'and it still opens the status editor', sec.tapOpens);
  ok(sec.rows>0, 'the Profile section still has its own rows', 'rows='+sec.rows);

  // Back to the hub, then the admin row must actually work.
  await p.evaluate(()=>acGoProfileHub()); await p.waitForTimeout(700);
  const adminRun = await p.evaluate(()=>{
    const body=document.getElementById('acMeBody');
    const r=[...body.querySelectorAll('.me-row')].find(e=>/admin dashboard/i.test(e.textContent||''));
    return r?r.getAttribute('onclick'):null;
  });
  ok(/openAdmin/.test(adminRun||''), 'the Admin dashboard row still opens the dashboard', adminRun);
  const setRun = await p.evaluate(()=>{
    const r=[...document.querySelectorAll('#acMeBody .me-row')].find(e=>/^Settings$/.test((e.textContent||'').trim()));
    return r?r.getAttribute('onclick'):null;
  });
  ok(/openSettings/.test(setRun||''), 'and Settings is on the main page and opens Settings', setRun);

  // ---- searchable ----------------------------------------------------------
  const found = await p.evaluate(()=>{
    const hits=acFindPlaces('admin dashboard',8)||[];
    return hits.map(x=>x.label+' | '+(x.sub||''));
  });
  ok(found.some(x=>/^Admin dashboard/i.test(x)), 'and search still finds it', JSON.stringify(found));

  // ---- 3 : Log out clears the bar -----------------------------------------
  const r = await p.evaluate(async()=>{
    const body=document.getElementById('acMeBody');
    const pg=document.body.classList.contains('pgscroll');
    const sc = pg ? (document.scrollingElement||document.documentElement) : body;
    for (let i=0;i<3;i++){ sc.scrollTop = sc.scrollHeight; window.dispatchEvent(new Event('scroll')); await new Promise(r=>setTimeout(r,700)); }
    const out=[...body.querySelectorAll('.me-row')].find(e=>/log out/i.test(e.textContent));
    const nav=document.getElementById('bottomNav');
    const q=out?out.getBoundingClientRect():null, n=nav.getBoundingClientRect();
    return {pgscroll:pg, found:!!out, navVisible:getComputedStyle(nav).display!=='none',
      logoutBottom:q?Math.round(q.bottom):null, navTop:Math.round(n.top), vh:innerHeight,
      padBottom:getComputedStyle(body).paddingBottom,
      clearance: q ? Math.round(n.top - q.bottom) : null};
  });
  console.log('  bottom: '+JSON.stringify(r));
  ok(r.found, 'the Log out row exists after scrolling to the bottom');
  ok(r.navVisible, 'the nav bar is actually on screen (else this check proves nothing)');
  ok(r.clearance !== null && r.clearance >= 8, 'Log out clears the floating nav bar', 'clearance '+r.clearance+'px');
  await p.screenshot({path:SP+'icons/ME-bottom.png'});
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
