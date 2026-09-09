/* ── THE FOUR WORLDS SHARE ONE HEADER ────────────────────────────────────────────
   Home · Beam · Engine · Notifications are the four surfaces that lead with the Atwe
   swirl and a title. The founder asked for them to have "the same full look and size and
   feel", and they did not: Notifications sat 4px lower than the other three and its header
   was the only one that did not roll away on scroll.

   The 4px was a hardcoded number that went stale underneath. #notifHead's top inset said a
   flat `13px`, which was RIGHT when it was typed in build 1712 — the gutter was 18 then,
   and the worlds compute `.topbar`'s own 2px + `--feed-gutter - (circle - h)/2` = 2+11 = 13
   — and silently WRONG from build 1744, when the gutter moved to 14 and the three worlds
   followed the formula down to 9 while this number stayed where it was. So the checks below
   are deliberately written as RELATIONSHIPS between the four worlds, never as numbers: a
   future change to the gutter, the circle size or the lockup height has to move all four
   together or this fails.

   Two things are NOT differences and must not be "fixed":
     · Home shows the Atwe LOGOTYPE where the other three show a word. Its ink therefore
       sits differently from a capital letter's. The shared anchor is the swirl MARK, which
       every one of the four has, and that is what is compared here.
     · Home and Beam carry three right-hand circles (＋ · ⋯ · avatar); Engine and
       Notifications carry two. Different buttons, same size, same right edge, same gap.
   Self-tested: putting the 13px back fails 6 checks; freezing the retract fails 2. */
process.env.JWT_SECRET=process.env.JWT_SECRET||'scoresecret';
const crypto=require('crypto');
const SP=__dirname+'/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:process.env.DATABASE_URL||'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'   :: '+String(x).slice(0,220):''));}};
const W=['Home','Beam','Engine','Notifications'];
const T=['follow','like','reply','mention','connection','endorse','repost'];

(async()=>{
  const hash=await auth.hashPassword('x'.repeat(12));
  const mk=async(pfx,n)=>{const e=crypto.randomUUID().slice(0,8)+'@t.local',h=pfx+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded)
      VALUES ($4,$1,$2,$3,true,true) RETURNING id`,[e,hash,h,n]); return {id:rows[0].id,email:e};};
  const me=await mk('wh','World Hdr');
  const token=auth.signToken({id:me.id,email:me.email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(token).digest('hex'),me.id]);
  /* varied types AND distinct actors, or the list groups into one row and there is
     nothing to scroll — the trap this page's notes already record */
  for(let i=0;i<30;i++){const a=await mk('wz','Actor '+i);
    await pool.query("INSERT INTO notifications (user_id,actor_id,type,read,created_at) VALUES ($1,$2,$3,false,now()-($4||' minutes')::interval)",
      [me.id,a.id,T[i%T.length],i]);
    /* …and a DM from each, or Beam's list is two rows tall and there is NOTHING TO
       SCROLL — which reads as "the header doesn't retract" on a header that is fine. */
    await pool.query("INSERT INTO at_messages (sender_id,recipient_id,body,created_at) VALUES ($1,$2,$3,now()-($4||' minutes')::interval)",
      [a.id,me.id,'Hello there '+i,i]);}

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];

  /* Read the header's geometry, whichever of the two elements is carrying it. */
  const MEAS=(sel)=>{
    const root=document.querySelector(sel); if(!root) return {missing:sel};
    const R=e=>{const r=e.getBoundingClientRect();return {t:+r.top.toFixed(2),l:+r.left.toFixed(2),r:+r.right.toFixed(2),b:+r.bottom.toFixed(2),w:+r.width.toFixed(2),h:+r.height.toFixed(2)};};
    const cs=getComputedStyle(root);
    const acts=[...root.querySelectorAll('.tb-brand-act')].filter(e=>e.getBoundingClientRect().height>0);
    const brand=root.querySelector('.tb-brand');
    /* the glass lives on the .topbar for the three worlds and on #notifHead itself for
       Notifications — ask the header's own host, not the row */
    const host=root.closest('.topbar')||root;
    const g=host.querySelector(':scope > .tb-glass');
    return {
      mark:R(root.querySelector('.tb-brand-mark')),
      brandGap:getComputedStyle(brand).gap,
      markLeftPad:cs.paddingLeft,
      acts:acts.map(R), actsN:acts.length,
      actsGap:getComputedStyle(root.querySelector('.tb-brand-actions')).gap,
      rowBottom:R(root).b,
      /* THE TAB ROW UNDER THE TITLE IS PART OF THE HEADER as far as a person is concerned.
         querySelector returns the FIRST match and Home's #tbFeedTabs comes before Beam's
         #tbChatTabs in the source, so asking for '.tb-feedtabs' on Beam hands back Home's
         hidden row and reports "no tabs" on a world that plainly has them — take the first
         VISIBLE one instead. Notifications draws .ntf-tabs; the other three .tb-feedtabs. */
      tabs:(()=>{
        const vis=(sel)=>{for(const e of document.querySelectorAll(sel))
          if(e.getBoundingClientRect().height>0) return e; return null;};
        const tr=vis('#notifOverlay:not(.hidden) .ntf-tabs')||vis('.topbar .tb-feedtabs')||vis('#acSearchScopes');
        if(!tr) return null;
        const chip=[...tr.children].find(e=>e.getBoundingClientRect().height>0);
        if(!chip) return null;
        const cb=chip.getBoundingClientRect(), cc=getComputedStyle(chip);
        return {rowGap:getComputedStyle(tr).gap, rowPadL:getComputedStyle(tr).paddingLeft,
          t:+cb.top.toFixed(1), h:+cb.height.toFixed(1), l:+cb.left.toFixed(1),
          fs:cc.fontSize, fw:cc.fontWeight};
      })(),
      glass:g?{layers:g.children.length,
        blurs:[...g.children].map(i=>{const c=getComputedStyle(i);return (c.backdropFilter||c.webkitBackdropFilter||'').replace(/[^0-9.]/g,'');}),
        stops:(getComputedStyle(g).backgroundImage.match(/rgba?\([^)]*\)/g)||[]).slice(0,3).join(' ')}:null,
    };
  };

  for (const width of [360,390,430]) {
   for (const theme of ['black','light']) {
    const p=await b.newPage({viewport:{width,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(width+'/'+theme+': '+String(e).slice(0,110)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([t,th])=>{localStorage.clear();localStorage.setItem('atwe_token',t);
      localStorage.setItem('atwe_theme',th);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[token,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5200);

    const m={};
    for (const w of W) {
      if (w==='Notifications') {
        await p.evaluate(()=>{try{closeOverlay('notifOverlay',true)}catch(e){} appTab('home');});
        await p.waitForTimeout(1100); await p.click('#bnav-notifs'); await p.waitForTimeout(2100);
        m[w]=await p.evaluate(MEAS,'#notifHead');
      } else {
        await p.evaluate(t=>{try{closeOverlay('notifOverlay',true)}catch(e){} appTab(t);}, w==='Home'?'home':w==='Beam'?'chat':'search');
        await p.waitForTimeout(1500);
        /* a bar left scroll-collapsed by an earlier step reports the wrong top and is
           not a valid reference — reset the scroll AND the transform the collapse writes */
        await p.evaluate(()=>{const se=document.scrollingElement; if(se)se.scrollTop=0;
          ['acFeed','acList','acSearchScroll'].forEach(id=>{const e=document.getElementById(id); if(e)e.scrollTop=0;});
          const tb=document.querySelector('.topbar'); if(tb){tb.style.transform='';tb.style.marginTop='';tb.style.opacity='';}
          window.dispatchEvent(new Event('scroll'));});
        await p.waitForTimeout(650);
        m[w]=await p.evaluate(MEAS,'#tbBrandRow');
      }
    }
    const tag=width+'/'+theme+'  ';
    const miss=W.filter(w=>m[w].missing); if(miss.length){ ok(false,tag+'all four headers are on screen',JSON.stringify(miss)); await p.close(); continue; }

    const H=m.Home;
    const eq=(f,label,tol)=>{
      const vals=W.map(w=>f(m[w]));
      const bad=W.filter((w,i)=>typeof vals[0]==='number'?Math.abs(vals[i]-vals[0])>(tol||0.6):vals[i]!==vals[0]);
      ok(bad.length===0, tag+label, W.map((w,i)=>w+'='+vals[i]).join('  '));
    };
    /* THE SWIRL IS THE SHARED ANCHOR — every one of the four has one, and it is the only
       thing in the lockup that is the same object on all four (Home's title is the
       logotype image, the rest are words). If these land together, the lockups do. */
    eq(x=>x.mark.t,'the swirl sits at the same height on all four');
    eq(x=>x.mark.l,'…and on the same left edge');
    eq(x=>x.mark.h,'…and is the same size');
    eq(x=>x.brandGap,'the gap between swirl and title is identical');
    eq(x=>x.markLeftPad,'all four start on the same gutter');
    /* the right-hand circles: different BUTTONS per world, but one size, one right edge,
       one gap, and level with each other */
    eq(x=>x.acts[x.acts.length-1].r,'the right-hand circles end on the same edge');
    eq(x=>x.acts[0].t,'…sit at the same height');
    eq(x=>x.acts[0].h,'…are the same size');
    eq(x=>x.actsGap,'…and are spaced the same');
    eq(x=>x.rowBottom,'the header row ends at the same point on all four');
    /* the row of tabs under the title. It was the second thing adrift: Notifications shipped
       13px text in a 29px pill against the worlds' 15px in 31, and its selected tab never
       took the bolder weight — three small differences that read as a different app's
       screen. The rule they now share says why in the founder's own words: "Home + Beam
       tabs must be IDENTICAL across worlds — same size/weight/colour so switching worlds
       never feels off." */
    if (W.every(w=>m[w].tabs)) {
      eq(x=>x.tabs.t,'the tab pills sit on the same line on all four');
      eq(x=>x.tabs.h,'…are the same height');
      eq(x=>x.tabs.fs,'…the same size of type');
      eq(x=>x.tabs.fw,'…the same weight');
      eq(x=>x.tabs.l,'…start on the same gutter');
      eq(x=>x.tabs.rowGap,'…and are spaced the same');
    } else {
      ok(false, tag+'all four have a tab row to compare', W.map(w=>w+'='+!!m[w].tabs).join(' '));
    }
    /* the glass: same material everywhere. Its HEIGHT is deliberately per-bar (the band is
       that bar's own visible height plus the tail), so height is not compared — the
       recipe is. */
    ok(W.every(w=>m[w].glass), tag+'every world bar is glass', W.map(w=>w+'='+!!m[w].glass).join(' '));
    if (W.every(w=>m[w].glass)) {
      eq(x=>x.glass.layers,'the glass is the same number of blur layers');
      eq(x=>x.glass.blurs.join('/'),'…with the same blur ramp');
      eq(x=>x.glass.stops,'…and the same tint');
    }
    await p.close();
   }
  }

  /* ── the retract, on all four ───────────────────────────────────────────────────
     A header that stands still while the other three roll away is a difference you feel
     rather than see. Notifications' was frozen in build 1766 because it hid by animating a
     margin-top from IN FLOW, which reflowed the list under the finger; it has been a
     floating absolute layer since it became glass, so it is one composited transform now.
     notifscroll.js owns the cost side of that bargain. */
  {
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push('roll: '+String(e).slice(0,110)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5200);
    /* WHICH THING SCROLLS DEPENDS ON WHERE YOU ARE, and getting it wrong reports a
       failure on a working header. In a mobile BROWSER the three worlds run in
       `body.pgscroll`: the WINDOW scrolls and #acFeed / #acList / #acSearchScroll are
       overflow:visible with scrollHeight === clientHeight, i.e. they do not scroll at
       all. (The installed PWA is the other way round — its own container scrolls and
       _onListScroll drives the collapse.) Notifications is neither: it is a panel whose
       #notifList is a real scroller in both. So ask the page rather than assuming. */
    const roll=async(w)=>{
      let sel,list;
      if(w==='Notifications'){ await p.evaluate(()=>{try{closeOverlay('notifOverlay',true)}catch(e){} appTab('home');});
        await p.waitForTimeout(1100); await p.click('#bnav-notifs'); await p.waitForTimeout(2100);
        sel='#notifHead'; list='#notifList'; }
      else { await p.evaluate(t=>{try{closeOverlay('notifOverlay',true)}catch(e){} appTab(t);}, w==='Home'?'home':w==='Beam'?'chat':'search');
        await p.waitForTimeout(1600); sel='.topbar'; list=w==='Home'?'#acFeed':w==='Beam'?'#acList':'#acSearchScroll'; }
      return await p.evaluate(async([s,l])=>{
        const hd=document.querySelector(s); if(!hd) return {missing:s};
        const inner=document.querySelector(l);
        const se=document.scrollingElement;
        /* whichever of the two can actually move is the one driving the collapse */
        const innerScrolls = inner && (inner.scrollHeight - inner.clientHeight) > 80;
        const winScrolls   = (se.scrollHeight - se.clientHeight) > 80;
        if(!innerScrolls && !winScrolls) return {nothingToScroll:l};
        const useWin = !innerScrolls;
        const set=(v)=>{ if(useWin){ se.scrollTop=v; window.dispatchEvent(new Event('scroll')); }
                         else { inner.scrollTop=v; inner.dispatchEvent(new Event('scroll')); } };
        const get=()=> useWin ? se.scrollTop : inner.scrollTop;
        set(0); await new Promise(r=>setTimeout(r,320));
        const before=hd.getBoundingClientRect().top;
        for(let i=0;i<10;i++){ set(get()+24); await new Promise(r=>requestAnimationFrame(r)); }
        await new Promise(r=>setTimeout(r,320));
        const after=hd.getBoundingClientRect().top;
        /* back to the top must put it fully back — a one-way hide strands the header */
        set(0); await new Promise(r=>setTimeout(r,460));
        return {scroller: useWin?'window':l, before:+before.toFixed(1), after:+after.toFixed(1),
                back:+hd.getBoundingClientRect().top.toFixed(1)};
      },[sel,list]);
    };
    for (const w of W) {
      const r=await roll(w);
      if(r.missing){ ok(false,'roll  '+w+': its header is on screen',r.missing); continue; }
      /* say so out loud rather than failing — a world with too little content to scroll
         proves nothing either way, and reporting it as a failure is how a probe cries
         wolf on working code */
      if(r.nothingToScroll){ console.log('  --   roll  '+w+': skipped, nothing to scroll ('+r.nothingToScroll+')'); continue; }
      ok(r.after < r.before - 8, 'roll  '+w+': the header rolls away as you scroll down', JSON.stringify(r));
      ok(Math.abs(r.back - r.before) < 2, 'roll  '+w+': …and comes all the way back at the top', JSON.stringify(r));
    }
    await p.close();
  }

  ok(errs.length===0,'no JS errors anywhere',errs.slice(0,3).join(' | ')||'0');
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
