/* The post card renders on 22 surfaces, not just Home. Visit the real ones and check
   the card paints and sits on a sane gutter everywhere. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,240):''));}};
const PHOTO='data:image/png;base64,'+Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAADZbCibAAAAG0lEQVQI12P8//8/AzbAxIAD0EFi'+'FDGMKjmMSgIAcMYD/Zn6+ZQAAAAASUVORK5CYII=','base64').toString('base64');
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='sw'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('Sweep',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  const {rows:pr}=await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at)
    VALUES ($1,'Sweep post with #cardsweep and a photo',$2,600,400,true,now()) RETURNING id`,[uid,PHOTO]);
  await pool.query(`INSERT INTO post_hashtags (post_id,tag) VALUES ($1,'cardsweep') ON CONFLICT DO NOTHING`,[pr[0].id]).catch(()=>{});
  await pool.query(`INSERT INTO post_bookmarks (post_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[pr[0].id,uid]).catch(()=>{});

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6500);
  await p.evaluate(u=>{document.body.dataset.sweepU=u;},h);

  const check=async(label, go, arg)=>{
    try { await p.evaluate(go, arg); } catch(e){ ok(false,label+' — opened', String(e).slice(0,90)); return; }
    await p.waitForTimeout(3200);
    const r=await p.evaluate(()=>{
      const all=[...document.querySelectorAll('.ac-post')];
      const el=all.find(e=>e.offsetParent);
      if(!el) return {none:true, total:all.length,
        screens:[...document.querySelectorAll('.ac-screen')].filter(s=>!s.classList.contains('hidden')).map(s=>s.id),
        empties:[...document.querySelectorAll('.ac-empty')].filter(e=>e.offsetParent).map(e=>(e.textContent||'').trim().slice(0,50))};
      const c=getComputedStyle(el,'::before'), bb=el.getBoundingClientRect();
      const n=v=>parseFloat(v)||0;
      return {bg:c.backgroundColor, r:n(c.borderRadius),
        container:(()=>{let q=el.parentElement,out=[];while(q&&out.length<3){const cs=getComputedStyle(q);
          out.push((q.id||q.className||q.tagName).toString().slice(0,24)+' pad='+cs.paddingLeft);q=q.parentElement;}return out;})(),
        left:Math.round(bb.left+n(c.left)), right:Math.round(innerWidth-(bb.right-n(c.right)))};
    });
    if (r.none){ ok(false, label+' — a post rendered', 'posts in DOM: '+r.total+'  visible screens: '+JSON.stringify(r.screens)+'  empty states: '+JSON.stringify(r.empties)); return; }
    const painted = r.bg && r.bg!=='rgba(0, 0, 0, 0)' && r.r>=20;
    ok(painted, label+' — the card paints', 'bg '+r.bg+' radius '+r.r);
    ok(r.left>=6 && r.left<=24 && Math.abs(r.left-r.right)<=2,
       label+' — sits on a sane, even gutter', 'left '+r.left+' right '+r.right+'  containers: '+JSON.stringify(r.container));
    await p.screenshot({path:SP+'icons/SWEEP-'+label.replace(/\W+/g,'-')+'.png'});
  };

  await check('home',      ()=>{ appTab('home'); acSetFeed('following'); });
  await check('profile',   (u)=>{ acGoProfile(u); }, h);
  await check('bookmarks', ()=>{ appTab('home'); acSetFeed('bookmarks'); });
  await check('hashtag',   ()=>{ acOpenHashtag('cardsweep'); });
  await check('search',    async()=>{ acGoSearch(); await new Promise(r=>setTimeout(r,500));
    acSetSearchScope('posts'); const i=document.getElementById('acSearchInput');
    if(i){ i.value='from:'+document.body.dataset.sweepU; i.dispatchEvent(new Event('input',{bubbles:true})); acDoSearch(); }
    await new Promise(r=>setTimeout(r,1800)); });

  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
