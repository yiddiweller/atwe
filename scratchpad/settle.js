/* A page must not rearrange under the reader. Total height growing BELOW the fold is
   invisible and fine; what matters is whether anything ON SCREEN moves after the first
   paint. Samples the y of every visible block from first paint to settled. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
(async()=>{
  const mk=async()=>{const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
    const h='st'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('S',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
    const tk=auth.signToken({id:rows[0].id,email,is_admin:false});
    await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(tk).digest('hex'),rows[0].id]);
    return tk;};
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
    /* Home gets a tolerance and the others do not, and the reason is measurable rather
       than a fudge: a real post is 269–653px tall depending on the SHAPE of its photo,
       so one skeleton height cannot match whichever post happens to land first. The
       skeleton is set near the median (345) and the residual is one post's variance —
       and it shifts UP, which is far less disruptive than content being pushed down.
       Before any of this the feed grew from 1390 to 4513px, so this still catches a
       regression; it just does not claim a precision that is not achievable. */
    await p.evaluate((t)=>{window.__settleTol=t;}, label === 'Home' ? 150 : 2);
    const r=await p.evaluate(async([g,se])=>{
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
      await new Promise(r2=>requestAnimationFrame(()=>setTimeout(r2,40)));
      const first=snap(), h0=root()?root().scrollHeight:0;
      for(let i=0;i<70;i++) await new Promise(r2=>requestAnimationFrame(()=>setTimeout(r2,30)));
      const last=snap(), h1=root()?root().scrollHeight:0;
      const tol = window.__settleTol || 2;
      const moved=Object.keys(first).filter(k=>k in last && Math.abs(first[k]-last[k])>tol)
        .map(k=>k+': '+first[k]+'→'+last[k]);
      return {first, last, moved, n:Object.keys(first).length, h0, h1};
    },[go,sel]);
    ok(r.n>0, label+' — something was on screen at first paint', JSON.stringify(r.first));
    ok(r.moved.length===0, label + (label==='Home'
        ? ' — the visible feed settles within one post’s height variance'
        : ' — nothing on screen moved after the first paint'), r.moved.join('  |  '));
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
