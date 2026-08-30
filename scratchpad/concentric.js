/* The concentric-corner law, measured. Wherever a rounded shape sits inside a rounded
   container, the OUTER radius must equal the inner radius PLUS the inset — that is the
   only arrangement where the two arcs share a centre and the gap stays even round the
   corner. Equal radii look right on paper and are 41% wider on the diagonal, which is
   what the founder's team kept marking. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
const PHOTO=require(SP+'mkpng.js')(640,400,[74,96,124]);
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};
(async()=>{
  const mk=async n=>{const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
    const u='cc'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,verified)
      VALUES ($1,$2,$3,$4,true,true,true) RETURNING id`,[n,e,h,u]); return {id:rows[0].id,u};};
  const me=await mk('Concentric'), other=await mk('Cornerstone Co Group');
  const t=auth.signToken({id:me.id,email:'x',is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),me.id]);
  await pool.query('INSERT INTO follows (follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[me.id,other.id]);
  await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at)
    VALUES ($1,'Networking really is just being genuinely curious about people.',$2,640,400,true,now())`,[other.id,PHOTO]);
  await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,'Small businesses.',true,now()-interval '2 minutes')`,[other.id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const w of [320,390,430]){
    console.log('\n══ '+w+'px ══');
    const p=await b.newPage({viewport:{width:w,height:880},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(7000);
    await p.evaluate(()=>acSetFeed('following')); await p.waitForTimeout(2800);
    const m=await p.evaluate(()=>{
      const post=document.querySelector('#acFeed .ac-post');
      const cs=getComputedStyle(post), g=n=>parseFloat(cs.getPropertyValue(n))||0;
      const cardR=parseFloat(getComputedStyle(post,'::before').borderTopLeftRadius);
      const R=e=>e.getBoundingClientRect();
      const eff=e=>{const c=getComputedStyle(e), r=R(e);
        const raw=c.borderTopLeftRadius;
        return raw.includes('%') ? Math.min(r.width,r.height)/2
             : Math.min(parseFloat(raw)||0, Math.min(r.width,r.height)/2);};
      const edge=g('--post-edge'), pad=g('--post-pad');
      const box={l:R(post).left+edge, t:R(post).top, r:R(post).right-edge};
      const inner=[];
      const av=post.querySelector('.ac-post-av .user-avatar');
      const more=post.querySelector('.ac-post-more');
      const img=post.querySelector('.ac-post-img,.ac-post-body img');
      const pills=[...post.querySelectorAll('.ac-post-actions > *')];
      if(av)   inner.push({n:'profile picture', r:eff(av),   inset:Math.round(R(av).left-box.l)});
      if(more) inner.push({n:'the ⋯',           r:eff(more), inset:Math.round(box.r-R(more).right)});
      if(img)  inner.push({n:'the photo',       r:eff(img),  inset:Math.round(R(img).left-box.l)});
      if(pills[0]) inner.push({n:'first action pill', r:eff(pills[0]), inset:Math.round(R(pills[0]).left-box.l)});
      if(pills.length) inner.push({n:'last action pill', r:eff(pills[pills.length-1]),
                                   inset:Math.round(box.r-R(pills[pills.length-1]).right)});
      const nav=document.getElementById('bottomNav'); const nr=R(nav);
      // widest count still inside its pill
      const clipped=pills.filter(e=>{const n=e.querySelector('.ac-act-n');
        return n && n.scrollWidth > n.clientWidth+1;}).length;
      return {cardR, pad, inner, navR:eff(nav), navGap:Math.round(box.r-nr.right),
              pillW:pills.length?Math.round(R(pills[0]).width):0, clipped,
              textW:Math.round(box.r-box.l-2*pad)};
    });
    console.log('     card corner '+m.cardR+'   padding '+m.pad+'   text width '+m.textW);
    for(const it of m.inner){
      const want=it.r+it.inset;
      ok(Math.abs(want-m.cardR)<=1.5,
        'concentric: '+it.n+' — its corner '+it.r+' + gap '+it.inset+' = '+want,
        'card is '+m.cardR);
    }
    ok(Math.abs((m.navR+m.navGap)-m.cardR)<=1.5,
      'concentric: the nav bar — its corner '+m.navR+' + gap '+m.navGap+' = '+(m.navR+m.navGap),
      'card is '+m.cardR);
    ok(m.clipped===0,'no action count is clipped at this width', m.clipped+' clipped, pill '+m.pillW+'px wide');
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
