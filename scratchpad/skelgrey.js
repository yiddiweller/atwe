/* The loading state must be the SAME card as a real post, with placeholders a step
   ABOVE it — not darker holes punched out of it. Reads real pixels from a screenshot,
   because computed style is not what lands on screen. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto'), fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,280):''));}};
const lum=(r,g,b)=>{const f=c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4);};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const theme of ['black','light']) {
    const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
    const h='sg'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('G',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
    const t=auth.signToken({id:rows[0].id,email,is_admin:false});
    await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),rows[0].id]);
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(6000);
    console.log('\n── '+theme+' ──');

    // hold the feed so the skeleton stays up, then shoot it
    await p.route('**/api/social/feed**', async r=>{ await new Promise(x=>setTimeout(x,20000)); r.abort(); });
    await p.evaluate(()=>{ acSetFeed('following'); });
    await p.waitForTimeout(1200);
    const geo = await p.evaluate(()=>{
      const post=document.querySelector('#acFeed .skel-post');
      if(!post) return null;
      const card=post.getBoundingClientRect();
      const sh=post.querySelector('.skel-line')||post.querySelector('.skel');
      const s=sh?sh.getBoundingClientRect():null;
      return {card:{x:card.left,y:card.top,w:card.width,h:card.height},
              shape:s?{x:s.left,y:s.top,w:s.width,h:s.height}:null};
    });
    ok(!!geo && !!geo.shape, 'the loading skeleton is on screen to test');
    if (!geo || !geo.shape) { await p.close(); continue; }
    const f=SP+'icons/SKEL-'+theme+'.png';
    await p.screenshot({path:f});
    const im=PNG.sync.read(fs.readFileSync(f));
    const at=(x,y)=>{const i=((im.width*Math.round(y*2)+Math.round(x*2))<<2);return [im.data[i],im.data[i+1],im.data[i+2]];};
    /* The CARD colour comes from its computed ::before and the PLACEHOLDER from a real
       pixel. Sampling the card by guessing a coordinate landed on the page instead, so
       the comparison was placeholder-vs-black and passed no matter what the card was —
       it would have passed with the old, inverted grey. The card is a flat fill with
       nothing painted over it, so computed and rendered agree there by construction;
       the placeholder is the one that needs a real pixel. */
    const cardPx = (await p.evaluate(()=>{
      const post=document.querySelector('#acFeed .skel-post');
      return getComputedStyle(post,'::before').backgroundColor;
    })).match(/\d+/g).slice(0,3).map(Number);
    const shapePx = at(geo.shape.x+geo.shape.w/2, geo.shape.y+geo.shape.h/2);
    const Lc=lum(...cardPx), Ls=lum(...shapePx);
    console.log('     card '+cardPx.join(',')+'   placeholder '+shapePx.join(','));
    /* The owner reversed this: the placeholder is now the SAME colour as a real action
       pill, so a loading card is one grey box with quieter shapes cut into it and there
       is no second grey anywhere in it — and loading -> loaded never changes tone. So the
       assertion is no longer a direction, it is an identity. */
    /* Read the token off BODY, not :root — body.light redefines it, and asking the root
       element hands back the Black value on both themes (which is how this first read
       "223,228,234 != 0,0,0" and blamed the app). */
    const pillPx=(await p.evaluate(()=>getComputedStyle(document.body)
      .getPropertyValue('--post-pill').trim()));
    const hx=pillPx.replace('#','');
    const want=[0,2,4].map(i=>parseInt(hx.slice(i,i+2),16));
    ok(want.every((v,i)=>Math.abs(v-shapePx[i])<=2),
       'the placeholder is exactly the action-pill colour — one grey in the card, no second one',
       'want '+want.join(',')+'  got '+shapePx.join(','));
    const ratio=(Math.max(Lc,Ls)+.05)/(Math.min(Lc,Ls)+.05);
    /* Asked darker three times: 1.36 ("a very light gray") -> 1.19 -> 1.07, and finally
       "make it fully black". It is the page colour on Black now (1.14 against the card).
       The floor is what stops the shapes disappearing altogether — a loading state with
       no visible placeholders just looks like a column of empty cards. */
    ok(ratio>1.08 && ratio<1.30, 'and it is a quiet step, not a light-grey block', ratio.toFixed(2)+':1');

    // the loading card and a real card must be the SAME grey
    await p.unroute('**/api/social/feed**');
    await p.evaluate(()=>{ acSetFeed('foryou'); });
    await p.waitForTimeout(3500);
    const realPx = await p.evaluate(()=>{
      const post=[...document.querySelectorAll('#acFeed .ac-post:not(.skel-post)')][0];
      return post ? getComputedStyle(post,'::before').backgroundColor : null;});
    const skelCard = await p.evaluate(()=>{
      const d=document.createElement('div'); d.className='ac-post skel-post'; document.body.appendChild(d);
      const c=getComputedStyle(d,'::before').backgroundColor; d.remove(); return c;});
    ok(realPx && realPx===skelCard, 'the loading card and the real card are the same grey', 'real '+realPx+'  loading '+skelCard);
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
