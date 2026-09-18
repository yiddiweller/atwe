/* A page must not rearrange under the reader. Total height growing BELOW the fold is
   invisible and fine; what matters is whether anything ON SCREEN moves after the first
   paint. Samples the y of every visible block from first paint to settled. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const QA=require('./qa-fixture');
const auth=require('/home/user/atwe/auth');
const pool=QA.newPool();
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
(async()=>{
  const mk=async()=>{const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
    const h='st'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('S',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
    const tk=auth.signToken({id:rows[0].id,email,is_admin:false});
    await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(tk).digest('hex'),rows[0].id]);
    // The session is only real if the SERVER can see it. Without this a probe on the
    // wrong database measures a signed-out app and blames the product.
    await QA.assertServerSees(tk);
    return tk;};
  /* HOME NEEDS SOMETHING IN THE FEED, AND IT USED TO BORROW IT. Every account this
     probe makes is brand new and follows nobody, so what fills For You is whatever
     posts happen to be in the database from other probes. On a genuinely empty one the
     feed is an empty state, there is nothing to settle, and the old check passed by
     measuring nothing at all. So it writes its own: one author, a handful of posts,
     seeded once and shared by every surface. */
  const author = await QA.seedAccount(pool, { prefix: 'sa' });
  for (let i = 0; i < 8; i++) {
    await pool.query(
      `INSERT INTO posts (user_id, body, to_main, created_at) VALUES ($1,$2,true,now()-($3||' seconds')::interval)`,
      [author.id, 'Settling post ' + i + ' — enough words to give the card a real height.', i]);
  }
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  // A FRESH account per surface: the already-seen filter serves a reused one different
  // posts, and the Explore cache makes a second visit trivially stable.
  const surfaces = [
    ['Engine',  "acGoSearch()",     '#acSearchPageResults'],
    ['Home',    "appTab('home')",   '#acFeed'],
    ['Beam',    "appTab('chat')",   '#acListScreen'],
    ['Account', "appTab('profile')",'#acMeBody'],
  ];
  for (const [label, go, sel] of surfaces) {
    const t=await mk();
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(6500);
    /* From here on, every API call takes 700ms — a phone on a real network, not a
       server on the same machine. Without this the blocks arrive within a frame or two
       and a broken page looks identical to a fixed one: the self-test passed with the
       fix removed until this was added. */
    await p.route('**/api/**', async (route) => { await new Promise(x=>setTimeout(x,700)); route.continue(); });
    /* HOME IS MEASURED FROM THE MOMENT REAL POSTS ARE ON SCREEN, not from a clock.
       It used to sample 40ms after appTab('home') and allow 150px of drift, and that
       number was neither derived nor stable: at 40ms the feed is part skeleton and part
       real post, and WHICH it is depends on how loaded the machine happens to be. Run
       alone it read 23px and passed; run inside the seven-probe suite the same build
       read 181px and failed. A check whose verdict tracks CPU load is not measuring the
       product.
       So the baseline waits for the state a reader is actually in — real posts, no
       skeletons — and then Home is held to the SAME 2px as every other surface. That is
       stricter than the fudge it replaces, not weaker: the skeleton-to-content swap is a
       legitimate transition nobody is reading through, and what must never happen is
       content moving once content has arrived. The swap itself is still bounded below,
       so a return of the 1390->4513px regression cannot slip past. */
    const isHome = label === 'Home';
    const r=await p.evaluate(async([g,se,home])=>{
      // eslint-disable-next-line no-eval
      eval(g);
      const root=()=>document.querySelector(se);
      /* Where is each ON-SCREEN block? Keyed by its position in the tree, so the same
         slot is compared across frames even as its content is swapped. */
      const snap=()=>{const r0=root(); if(!r0) return {};
        const out={}; let i=0;
        for (const el of r0.querySelectorAll(':scope > *')) {
          const bb=el.getBoundingClientRect();
          if (bb.bottom>0 && bb.top<innerHeight) out['slot'+(i)]=Math.round(bb.top);
          i++; if(i>8) break;
        }
        return out;};
      const frame=()=>new Promise(r2=>requestAnimationFrame(()=>setTimeout(r2,30)));
      await new Promise(r2=>requestAnimationFrame(()=>setTimeout(r2,40)));
      const opened=snap(), h0=root()?root().scrollHeight:0;
      /* Home only: advance to the state being judged. Bounded, and it reports whether
         it got there so a feed that never loads is a named failure, not a silent pass. */
      let ready=true;
      if (home) {
        ready=false;
        for (let i=0;i<120 && !ready;i++) {
          await frame();
          const r0=root();
          ready = !!r0 && r0.querySelectorAll('.skel-post').length===0
                       && r0.querySelectorAll('.ac-post').length>0;
        }
      }
      const first=snap();
      for(let i=0;i<70;i++) await frame();
      const last=snap(), h1=root()?root().scrollHeight:0;
      const drift=(a,b)=>Object.keys(a).filter(k=>k in b && Math.abs(a[k]-b[k])>2)
        .map(k=>k+': '+a[k]+'→'+b[k]);
      const worst=(a,b)=>Object.keys(a).reduce((m,k)=>k in b?Math.max(m,Math.abs(a[k]-b[k])):m,0);
      return {first, last, opened, ready, moved:drift(first,last), load:drift(opened,first),
              loadWorst:worst(opened,first),
              n:Object.keys(first).length, h0, h1, vh:innerHeight};
    },[go,sel,isHome]);
    ok(r.n>0, label+' — something was on screen at first paint', JSON.stringify(r.first));
    if (isHome) ok(r.ready, 'Home — the feed really replaced its skeleton with posts');
    ok(r.moved.length===0, label + (isHome
        ? ' — nothing moves once the real feed is on screen'
        : ' — nothing on screen moved after the first paint'), r.moved.join('  |  '));
    /* The swap itself. A placeholder cannot know the shape of a photo it has not seen,
       so on a brand-new account some displacement is unavoidable — but it must stay
       within a SCREEN. The regression this replaces displaced the column by thousands
       of pixels; bounding it by the viewport is a line a reader can feel rather than a
       number tuned to whatever today happens to measure. */
    if (isHome)
      ok(r.loadWorst < r.vh, 'Home — loading displaces the column by less than one screen',
         r.loadWorst + 'px of ' + r.vh + '  |  ' + r.load.join('  |  '));
    /* Engine must also not GROW. Its blocks arrive one request at a time, and on an
       account that has content in them (recents, collections) they sit above the fold,
       so growth there pushes the page down under the reader — which is what the owner
       reported. A fresh test account renders them empty and below the fold, so the
       on-screen check above cannot see it; the height is what proves the reservation.
       Home is exempt: it legitimately grows as 5 skeleton posts become a real feed,
       entirely below the fold. */
    if (label === 'Engine')
      ok(r.h1 <= r.h0 + 4, label+' — and the page did not grow under the reader', r.h0+'px \u2192 '+r.h1+'px');
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
