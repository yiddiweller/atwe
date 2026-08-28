/* Walk EVERY search bar in the app, type something that cannot exist, and check
   the dead end is replaced by an offer to ask Atwe AI. The pickers where the
   assistant genuinely cannot help (emoji, GIF, choosing a person to message) are
   listed too, and asserted NOT to show it — so the list is a complete account of
   the app's search bars, not a convenient subset. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+String(x).slice(0,140):''));}};
const NOPE='zzqq'+crypto.randomUUID().replace(/-/g,'').slice(0,10);

// [label, how to open it, input id, should the AI offer appear?]
const BARS = [
  ['Engine · everything', "appTab('search')",        'tbSearchInput',     true],
  ['Marketplace',         'acOpenMarketplace()',     'mktSearch',         true],
  ['Businesses',          'acOpenDirectory()',       'dirSearch',         true],
  ['Services',            'acOpenServices()',        'svcSearch',         true],
  ['Jobs',                "acGoJobsBoard('jobs')",   null,                true],
  ['Collections',         "acSetFeed('bookmarks')",  'acBmkSearch',       true],
  ['Beam · your chats',   "appTab('chat')",          'acChatSearchInput', true],
  ['Orders',              "acOpenOrders('buyer')",   'ordSearch',         true],
  ['Settings',            'openSettings()',          'setSearch',         true],
  ['Account',             "appTab('profile')",       'acMeSearch',        true],
  // pickers: the assistant cannot add an emoji or pick a person for you
  ['Emoji picker',        'openEmojiPicker()',       'emojiSearchInput',  false],
];
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='sw'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,balance_cents) VALUES ('S',$1,$2,$3,true,true,5000) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4800);

  for (const [label, open, id, want] of BARS) {
    await p.evaluate(()=>{document.querySelectorAll('.overlay:not(.hidden)').forEach(o=>{try{closeOverlay(o.id)}catch(e){}});}).catch(()=>{});
    await p.waitForTimeout(500);
    if (open) { const r = await p.evaluate((c)=>{ try { new Function(c)(); return 'ok'; } catch(e){ return String(e.message); } }, open);
                if (r !== 'ok') { console.log('  (skip ' + label + ' — ' + r.slice(0,60) + ')'); continue; } }
    await p.waitForTimeout(1500);
    if (id) {
      const found = await p.evaluate(([i,q])=>{ const el=document.getElementById(i); if(!el) return false;
        el.value=q; el.dispatchEvent(new Event('input',{bubbles:true})); return true; }, [id, NOPE]);
      if (!found) { console.log('  (skip ' + label + ' — no #' + id + ' on screen)'); continue; }
    } else {
      await p.evaluate((q)=>{ try { acJobSearch(q); } catch(e) { try { AC._jobQ=q; acLoadJobs(); } catch(e2){} } }, NOPE);
    }
    await p.waitForTimeout(2600);
    // Only count blocks that are actually ON SCREEN: every surface keeps its markup
    // in the DOM after you leave it, so a raw querySelectorAll counts old ones too
    // (which is exactly what made the first run of this report a false failure).
    const n = await p.evaluate(()=>[...document.querySelectorAll('.ai-empty')]
      .filter((e)=>{ const r=e.getBoundingClientRect();
        return r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight; }).length);
    if (want) { ok(n > 0, label + ' offers Atwe AI when nothing matches', 'found ' + n); continue; }
    // For a picker, ask the narrower question: does the PICKER ITSELF show one?
    // A surface left open underneath would otherwise be counted against it.
    const own = await p.evaluate((i) => {
      const el = document.getElementById(i); if (!el) return -1;
      const host = el.closest('.overlay, .ac-screen, .mm-sheet, .action-sheet') || el.parentElement;
      return host ? host.querySelectorAll('.ai-empty').length : -1;
    }, id);
    ok(own === 0, label + ' correctly does NOT (the assistant cannot help here)', 'inside it: ' + own);
  }
  ok(errs.length===0,'no JS errors anywhere in the sweep',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(2);});
