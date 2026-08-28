/* The Account page's inline search + the two-way iOS push/pop.
   Everything asserts the thing EXISTS before judging it, so a rename fails loudly. */
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
  const h='ms'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin) VALUES ('M',$1,$2,$3,true,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,180)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1600);

  // ---- placement --------------------------------------------------------
  const place = await p.evaluate(()=>{
    const body=document.getElementById('acMeBody');
    const s=body.querySelector('.me-search'), w=body.querySelector('.me-wallet'), g=body.querySelector('.me-group');
    const inp=document.getElementById('acMeSearch');
    const R=e=>e?e.getBoundingClientRect():null;
    return { has:!!s, hasInput:!!inp,
      afterWallet: !!(s&&w&&(w.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING)),
      beforeGroups: !!(s&&g&&(s.compareDocumentPosition(g)&Node.DOCUMENT_POSITION_FOLLOWING)),
      insideGroup: !!(s&&s.closest('.me-group')),
      walletBottom:R(w)?Math.round(R(w).bottom):null, searchTop:R(s)?Math.round(R(s).top):null,
      searchLeft:R(s)?Math.round(R(s).left):null, groupLeft:R(g)?Math.round(R(g).left):null,
      radius:s?getComputedStyle(s).borderRadius:null, h:R(s)?Math.round(R(s).height):0,
      border:s?getComputedStyle(s).borderTopWidth:null,
      ph:inp?inp.placeholder:null, aria:inp?inp.getAttribute('aria-label'):null,
      xHidden: (document.getElementById('acMeSearchX')||{}).className };
  });
  console.log('  place: '+JSON.stringify(place));
  ok(place.has && place.hasInput, 'there is a search bar with a real input');
  ok(place.afterWallet, 'it sits under the wallet card');
  ok(place.beforeGroups, 'and above the sections card');
  ok(place.insideGroup===false, 'it is its OWN block, not a row inside a card');
  ok(place.searchLeft===place.groupLeft, 'aligned to the same gutter as the cards', place.searchLeft+' vs '+place.groupLeft);
  /* --card-r is 26, but a 42px-tall box clamps it to ~half its height — so the bar
     renders as a capsule, exactly like Apple's search field. Assert the SHAPE, not the
     token: a literal '26px' check fails on clamping and a literal '18px' check would
     break the moment the bar's height changes. */
  ok(parseFloat(place.radius)*2 >= place.h - 8,
     'the search field reads as a capsule, like the rest of the card system',
     'radius '+place.radius+' on a '+place.h+'px-tall bar');
  ok(place.border==='0px', 'solid fill, no outline (design rule)', place.border);
  ok(/search/i.test(place.ph||'') , 'it says what it searches', place.ph);
  ok(!!place.aria, 'the input has an accessible name (a placeholder is not one)', place.aria);
  ok(/hidden/.test(place.xHidden||''), 'the clear button is hidden until you type');

  // ---- searching ---------------------------------------------------------
  await p.evaluate(()=>{const i=document.getElementById('acMeSearch');i.value='gift cards';i.dispatchEvent(new Event('input'));});
  await p.waitForTimeout(400);
  const r1 = await p.evaluate(()=>{
    const list=document.getElementById('acMeList'), res=document.getElementById('acMeResults');
    const rows=[...res.querySelectorAll('.me-row')];
    return { listHidden:list.classList.contains('hidden'), resShown:!res.classList.contains('hidden'),
      n:rows.length, first:(rows[0]?rows[0].textContent:'').replace(/\s+/g,' ').trim(),
      firstRun:rows[0]?rows[0].getAttribute('onclick'):null,
      xShown: !document.getElementById('acMeSearchX').classList.contains('hidden'),
      subs: rows.slice(0,4).map(e=>(e.querySelector('.me-secsub')||{}).textContent) };
  });
  console.log('  query: '+JSON.stringify(r1).slice(0,400));
  ok(r1.listHidden && r1.resShown, 'typing swaps the cards for results');
  ok(r1.n>0, 'a real query finds something', 'n='+r1.n);
  ok(/^Gift cards/i.test(r1.first||''), 'the best match is the one you asked for', r1.first);
  ok(/acOpenGiftCards|GiftCard/i.test(r1.firstRun||''), 'and it wires to the real destination', r1.firstRun);
  ok((r1.subs||[]).every(x=>x && /^Account/.test(x)), 'every result names its section, and all are Account rows', JSON.stringify(r1.subs));
  ok(r1.xShown, 'the clear button appears once you type');
  // Each result must wear its OWN icon, not a column of identical magnifiers.
  const ic = await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('#acMeResults .me-row')];
    const svgs=rows.map(r=>{const s=r.querySelector('.me-ic svg');return s?s.innerHTML.replace(/\s+/g,''):'';});
    return { n:rows.length, distinct:new Set(svgs).size, empty:svgs.filter(x=>!x).length };
  });
  ok(ic.empty===0, 'every result row has an icon', JSON.stringify(ic));
  ok(ic.n < 2 || ic.distinct > 1, 'and they are the rows\u2019 own icons, not one repeated magnifier', JSON.stringify(ic));

  // it must NOT leak destinations from other worlds
  await p.evaluate(()=>{const i=document.getElementById('acMeSearch');i.value='marketplace';i.dispatchEvent(new Event('input'));});
  await p.waitForTimeout(350);
  const r2 = await p.evaluate(()=>[...document.querySelectorAll('#acMeResults .me-row .me-secsub')].map(e=>e.textContent));
  ok(r2.length===0 || r2.every(x=>/^Account/.test(x)), 'a word that also names a world still only returns Account rows', JSON.stringify(r2));

  // a query that matches nothing offers Atwe AI (the app-wide convention)
  await p.evaluate(()=>{const i=document.getElementById('acMeSearch');i.value='zzqqxx';i.dispatchEvent(new Event('input'));});
  await p.waitForTimeout(350);
  const r3 = await p.evaluate(()=>{
    const res=document.getElementById('acMeResults');
    return { txt:(res.textContent||'').replace(/\s+/g,' ').trim().slice(0,120),
             ai: !!res.querySelector('[onclick*="acAskAiFromSearch"]') };
  });
  ok(r3.ai, 'a dead end offers Atwe AI, like every other search in the app', r3.txt);

  // clear puts it back
  await p.evaluate(()=>acMeSearchClear()); await p.waitForTimeout(350);
  const r4 = await p.evaluate(()=>{
    const list=document.getElementById('acMeList'), res=document.getElementById('acMeResults');
    return { listBack:!list.classList.contains('hidden'), resHidden:res.classList.contains('hidden'),
      val:document.getElementById('acMeSearch').value,
      xHidden:document.getElementById('acMeSearchX').classList.contains('hidden'),
      sections:[...list.querySelectorAll('.me-sec')].length };
  });
  console.log('  cleared: '+JSON.stringify(r4));
  ok(r4.listBack && r4.resHidden && r4.val==='' && r4.xHidden, 'clearing restores the page exactly');
  ok(r4.sections===10, 'all 10 section rows are back (App & help is its own card)', 'sections='+r4.sections);

  // tapping a result actually opens the destination
  await p.evaluate(()=>{const i=document.getElementById('acMeSearch');i.value='gift cards';i.dispatchEvent(new Event('input'));});
  await p.waitForTimeout(350);
  await p.evaluate(()=>document.querySelector('#acMeResults .me-row').click());
  await p.waitForTimeout(1400);
  const opened = await p.evaluate(()=>{
    const v=document.getElementById('giftCardView');
    return { exists:!!v, open: !!(v && !v.classList.contains('hidden') && getComputedStyle(v).display!=='none') };
  });
  ok(opened.exists && opened.open, 'tapping a result opens that destination', JSON.stringify(opened));
  await p.evaluate(()=>{ try{ closeOverlay('giftCardView'); }catch(e){} }); await p.waitForTimeout(600);

  // ---- the push/pop -------------------------------------------------------
  await p.evaluate(()=>acGoProfileHub()); await p.waitForTimeout(700);
  const anim = await p.evaluate(async()=>{
    const body=document.getElementById('acMeBody');
    acMeSection('money');
    await new Promise(r=>requestAnimationFrame(r));
    const fwd = getComputedStyle(body).animationName;
    const dur = getComputedStyle(body).animationDuration;
    const ease = getComputedStyle(body).animationTimingFunction;
    await new Promise(r=>setTimeout(r,500));
    acGoProfileHub();
    await new Promise(r=>setTimeout(r,60));
    await new Promise(r=>requestAnimationFrame(r));
    const back = getComputedStyle(document.getElementById('acMeBody')).animationName;
    return {fwd,back,dur,ease};
  });
  await p.waitForTimeout(700);
  console.log('  anim: '+JSON.stringify(anim));
  ok(anim.fwd==='meSlideIn', 'drilling into a section slides in from the right', anim.fwd);
  ok(anim.back==='meSlideBack', 'and coming back slides in from the left', anim.back);
  ok(anim.dur==='0.36s', 'same duration the Settings pages use', anim.dur);
  ok(/0\.32/.test(anim.ease||''), 'same iOS easing curve as Settings', anim.ease);

  // reduce-motion must switch it off
  const rm = await p.evaluate(async()=>{
    document.body.classList.add('reduce-motion');
    acMeSection('money'); await new Promise(r=>requestAnimationFrame(r));
    const n=getComputedStyle(document.getElementById('acMeBody')).animationName;
    document.body.classList.remove('reduce-motion'); acGoProfileHub();
    return n;
  });
  await p.waitForTimeout(600);
  ok(rm==='none', 'reduced motion switches the slide off', rm);

  ok(errs.length===0,'no JS errors',errs.join(' | '));
  await p.screenshot({path:SP+'icons/ACC-search.png'});
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
