/* A post card has something in each of its four corners: the profile picture top-left,
   the ⋯ top-right, and the first and last action pills along the bottom. Each must be
   inset by --post-pad on BOTH of its axes, so the gap to the card's edge is the same all
   the way round. Three corners were; the ⋯ was 10 from the right and 6.4 from the top,
   pulled out by negative margins left over from when the header row had no fixed height.
   One corner of every post in the app was tighter than the other three. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
const PHOTO=require(SP+'mkpng.js')(600,400,[240,240,238]);
let pass=0,fail=0;
const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
const PROBE = (sel)=>{
  const c=document.querySelector(sel); if(!c) return null;
  const r=c.getBoundingClientRect();
  const cs=getComputedStyle(c);
  const edge=parseFloat(cs.getPropertyValue('--post-edge'))||0;
  const gap=parseFloat(cs.getPropertyValue('--post-gap'))||0;
  const pad=parseFloat(cs.getPropertyValue('--post-pad'))||0;
  const box={l:r.left+edge,t:r.top,r:r.right-edge,b:r.bottom-gap};
  const ins=(e)=>{if(!e)return null;const x=e.getBoundingClientRect();
    return {l:+(x.left-box.l).toFixed(1),t:+(x.top-box.t).toFixed(1),
            r:+(box.r-x.right).toFixed(1),b:+(box.b-x.bottom).toFixed(1)};};
  const pills=[...c.querySelectorAll('.ac-post-actions>*,.ac-pf-actions>*')];
  const box2=e=>{if(!e)return null;const x=e.getBoundingClientRect();
    return {h:+x.height.toFixed(1),txt:(e.textContent||'').trim().slice(0,24)};};
  return {pad,
    name:box2(c.querySelector('.ac-post-name')),
    handle:box2(c.querySelector('.ac-post-handle')),
    tl:ins(c.querySelector('.user-avatar')),
    tr:ins(c.querySelector('.ac-post-more')),
    bl:ins(pills[0]), br:ins(pills[pills.length-1])};};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='pc'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('Michael Silva',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id; const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  const {rows:pr}=await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at) VALUES ($1,'Rates moved. Here is what it means for buyers.',$2,600,400,true,now()) RETURNING id`,[uid,PHOTO]);
  for(let i=1;i<4;i++) await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,$2,true,now()-($3||' seconds')::interval)`,[uid,'Another post '+i,i]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  for(const theme of ['black','light']){
    console.log('\n== '+theme+' ==');
    const errs=[];
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(7000);
    await p.evaluate(()=>acSetFeed('following'));
    await p.waitForTimeout(2500);
    const check=(where,g)=>{
      if(!g){ ok(false,where+': a post is on screen to test'); return; }
      /* The name column has a FIXED height, so flex will silently shrink a line to nothing
         if anything else is put in there — that is how the @handle vanished from every post
         when the dots grew. Assert both lines actually have height, not just that they exist. */
      ok(g.name && g.name.h>8, where+': the display name is showing', JSON.stringify(g.name));
      ok(g.handle && g.handle.h>8, where+': the @username is showing under it', JSON.stringify(g.handle));
      const names={tl:'profile picture (top-left)',tr:'the ⋯ (top-right)',
                   bl:'first action pill (bottom-left)',br:'last action pill (bottom-right)'};
      for(const k of ['tl','tr','bl','br']){
        const v=g[k]; if(!v){ ok(false,where+': '+names[k]+' is present'); continue; }
        const a = k[0]==='t' ? v.t : v.b;          // its distance from the near horizontal edge
        const b2= k[1]==='l' ? v.l : v.r;          // and from the near vertical edge
        console.log('     '+names[k].padEnd(32)+' '+a+' from the edge above/below, '+b2+' from the side');
        ok(Math.abs(a-g.pad)<0.8 && Math.abs(b2-g.pad)<0.8,
           where+': '+names[k]+' is inset by the card’s own padding on both sides',
           'got '+a+' / '+b2+', want '+g.pad+' / '+g.pad);}};
    check('feed', await p.evaluate(PROBE,'#acFeed .ac-post'));
    await p.evaluate(id=>acOpenPostView(id), pr[0].id);
    await p.waitForTimeout(2500);
    check('post page', await p.evaluate(PROBE,'.ac-postfocus'));
    ok(errs.length===0,'no page errors',errs.join(' | '));
    await p.close();
  }
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
