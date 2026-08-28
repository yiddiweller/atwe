/* Tapping a post shows the SAME card as the feed (owner), and post photos have lost
   the hairline while chat photos keep theirs. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,260):''));}};
const PHOTO='data:image/png;base64,'+Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAADZbCibAAAAG0lEQVQI12P8//8/AzbAxIAD0EFi'+'FDGMKjmMSgIAcMYD/Zn6+ZQAAAAASUVORK5CYII=','base64').toString('base64');
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='pd'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('D',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  const {rows:pr}=await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at)
    VALUES ($1,'Detail probe — a post with a photo',$2,600,400,true,now()) RETURNING id`,[uid,PHOTO]);
  const postId=pr[0].id;
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const theme of ['black','light']) {
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(6000);
    console.log('\n── '+theme+' ──');
    await p.evaluate(id=>acOpenPostView(id), postId);
    await p.waitForTimeout(2500);

    const r=await p.evaluate(()=>{
      const el=document.querySelector('.ac-postfocus');
      if(!el) return {none:true};
      const card=getComputedStyle(el,'::before'), row=getComputedStyle(el);
      const n=v=>parseFloat(v)||0;
      const bb=el.getBoundingClientRect();
      const img=el.querySelector('.ac-post-img');
      const acts=[...el.querySelectorAll('.ac-pf-actions>*')];
      const a0=acts[0], aB=a0?a0.getBoundingClientRect():null;
      const hit=e2=>{const q=e2.getBoundingClientRect(), pe=getComputedStyle(e2,'::before');
        return {w:Math.round(q.width-n(pe.left)-n(pe.right)), h:Math.round(q.height-n(pe.top)-n(pe.bottom))};};
      return {gutterTok:Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--feed-gutter'))||0),
        cardBg:card.backgroundColor, cardR:n(card.borderRadius), pad:n(row.paddingTop),
        left:Math.round(bb.left+n(card.left)), right:Math.round(innerWidth-(bb.right-n(card.right))),
        imgR:img?n(getComputedStyle(img).borderRadius):null,
        imgBorder:img?getComputedStyle(img).borderTopWidth:null,
        pillBg:a0?getComputedStyle(a0).backgroundColor:null,
        pillH:aB?Math.round(aB.height):null,
        pillR:a0&&aB?Math.min(n(getComputedStyle(a0).borderRadius), aB.height/2):null,
        hits:acts.map(hit),
        dividers:[row.borderTopWidth,row.borderBottomWidth],
        actDiv:(()=>{const q=el.querySelector('.ac-pf-actions'); if(!q) return null;
          const c=getComputedStyle(q); return [c.borderTopWidth,c.borderBottomWidth];})(),
      };
    });
    if(r.none){ ok(false,'the post detail rendered'); await p.close(); continue; }
    ok(r.cardBg && r.cardBg!=='rgba(0, 0, 0, 0)' && r.cardR>=20, 'the detail page is a card, like the feed', 'bg '+r.cardBg+' radius '+r.cardR);
    ok(r.left===r.gutterTok && r.right===r.gutterTok, 'on the same gutter as the feed ('+r.gutterTok+'px)', r.left+' / '+r.right+'  token '+r.gutterTok);
    ok(Math.abs(r.imgR-(r.cardR-r.pad))<0.6, 'its photo’s corner is concentric with the card', 'want '+(r.cardR-r.pad)+', got '+r.imgR);
    ok(r.imgBorder==='0px', 'and the photo has no hairline any more', r.imgBorder);
    ok(r.pillBg && r.pillBg!=='rgba(0, 0, 0, 0)', 'its actions are pills too', r.pillBg);
    ok(Math.abs(r.pillR-(r.cardR-r.pad))<0.6, 'with the same concentric corner', 'want '+(r.cardR-r.pad)+', got '+r.pillR);
    ok(r.hits.every(o=>o.w>=44&&o.h>=44), 'every detail action meets the 44pt minimum', JSON.stringify(r.hits));
    ok(r.dividers.every(v=>v==='0px') && (r.actDiv||[]).every(v=>v==='0px'), 'the old divider lines are gone', JSON.stringify([r.dividers,r.actDiv]));
    await p.screenshot({path:SP+'icons/DETAIL-'+theme+'.png'});

    // chat photos KEEP the hairline
    const chat=await p.evaluate(()=>{
      const d=document.createElement('img'); d.className='msg-photo'; document.body.appendChild(d);
      const w=getComputedStyle(d).borderTopWidth; d.remove(); return w;});
    ok(chat!=='0px', 'a CHAT photo still has its hairline', 'msg-photo border '+chat);
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
