/* The action row is ONE even rhythm: every button the same width, every gap between them
   the card's own edge padding, and the first and last sitting that same distance from the
   card's sides. Checked with counts on some buttons and not others — sizing to content is
   exactly what used to make them different widths (measured 45 vs 40). */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
const PROBE = (sel)=>{
  const c=document.querySelector(sel); if(!c) return null;
  const r=c.getBoundingClientRect(), cs=getComputedStyle(c);
  const edge=parseFloat(cs.getPropertyValue('--post-edge'))||0;
  const pad=parseFloat(cs.getPropertyValue('--post-pad'))||0;
  const box={l:r.left+edge,r:r.right-edge};
  const btns=[...c.querySelectorAll('.ac-post-actions>*,.ac-pf-actions>*')];
  if(!btns.length) return null;
  const rects=btns.map(e=>e.getBoundingClientRect());
  const widths=rects.map(x=>+x.width.toFixed(1));
  const gaps=[]; for(let i=1;i<rects.length;i++) gaps.push(+(rects[i].left-rects[i-1].right).toFixed(1));
  const squashed=btns.map(e=>{const g=e.querySelector('svg');
    if(!g) return false; const w=g.getBoundingClientRect().width;
    const want=parseFloat(getComputedStyle(g).width)||0;
    return want>0 && w < want-0.5;});
  const truncated=btns.map(e=>{const n=e.querySelector('.ac-act-n');
    if(!n||!(n.textContent||'').trim()) return false;
    return n.scrollWidth > n.clientWidth+1;});
  const spilled=btns.map((e,i)=>{const n=e.querySelector('.ac-act-n');
    if(!n||!(n.textContent||'').trim()) return false;
    const nb=n.getBoundingClientRect(), eb=rects[i];
    return nb.right>eb.right+0.5||nb.left<eb.left-0.5;});
  return {pad, widths, gaps, n:btns.length,
    leftGap:+(rects[0].left-box.l).toFixed(1),
    rightGap:+(box.r-rects[rects.length-1].right).toFixed(1),
    squashed:squashed.map((v,i)=>v?i:null).filter(v=>v!==null),
    truncated:truncated.map((v,i)=>v?i:null).filter(v=>v!==null),
    spilled:spilled.map((v,i)=>v?i:null).filter(v=>v!==null),
    counts:btns.map(e=>{const n=e.querySelector('.ac-act-n');return n?(n.textContent||'').trim():'';})};};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='ar'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('Row',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id; const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  // one post with big counts on some buttons and none on others — the case that used to
  // make the widths differ, and the case that could clip a number on a narrow phone
  const {rows:pr}=await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,'Working on something exciting — more soon.',true,now()) RETURNING id`,[uid]);
  const pid=pr[0].id;
  // a real like so SOME buttons carry a count and others do not — sizing to content is
  // exactly what used to make those two different widths
  await pool.query(`INSERT INTO post_likes (post_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[pid,uid]).catch(()=>{});
  await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,'A second post.',true,now()-interval '5 seconds')`,[uid]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  for(const W of [320,390,430]){
    console.log('\n== '+W+'px wide phone ==');
    const p=await b.newPage({viewport:{width:W,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(7000);
    await p.evaluate(()=>acSetFeed('following'));
    await p.waitForTimeout(2500);
    const check=(where,g)=>{
      if(!g){ ok(false,where+': an action row is on screen'); return; }
      console.log('     widths '+JSON.stringify(g.widths)+'  gaps '+JSON.stringify(g.gaps)+'  edges '+g.leftGap+'/'+g.rightGap+'  counts '+JSON.stringify(g.counts));
      const w0=g.widths[0];
      ok(g.widths.every(w=>Math.abs(w-w0)<0.8), where+': every button is the same width ('+w0+')', JSON.stringify(g.widths));
      ok(g.gaps.every(x=>Math.abs(x-g.pad)<0.8), where+': every gap between them is the card’s own edge padding ('+g.pad+')', JSON.stringify(g.gaps));
      ok(Math.abs(g.leftGap-g.pad)<0.8 && Math.abs(g.rightGap-g.pad)<0.8,
         where+': and the row starts and ends on that same gap', g.leftGap+' / '+g.rightGap);
      /* The icon is what the button MEANS, so it must never be squeezed — equal-width
         buttons no longer grow to fit a big number, and without this the icons collapsed
         to slivers on a narrow phone while the number spilled past the pill. */
      ok(g.squashed.length===0, where+': no icon is squashed', 'squashed at '+JSON.stringify(g.squashed));
      ok(g.spilled.length===0, where+': nothing escapes the pill', 'spilled at '+JSON.stringify(g.spilled));
      if(W>=390) ok(g.truncated.length===0, where+': and no count is cut short on a normal phone',
         'cut at '+JSON.stringify(g.truncated)+' of '+JSON.stringify(g.counts));};
    check('feed', await p.evaluate(PROBE,'#acFeed .ac-post'));
    /* Worst realistic case for clipping: every count at its widest compacted form. Seeding
       millions of rows would take minutes; the layout question is purely how wide the text
       is, so set the text and re-measure. */
    await p.evaluate(()=>{document.querySelectorAll('#acFeed .ac-post .ac-act-n').forEach(n=>n.textContent='9.9M');});
    await p.waitForTimeout(300);
    check('feed with 9.9M on every button', await p.evaluate(PROBE,'#acFeed .ac-post'));
    await p.evaluate(id=>acOpenPostView(id), pid);
    await p.waitForTimeout(2500);
    check('post page', await p.evaluate(PROBE,'.ac-postfocus'));
    await p.close();
  }
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
