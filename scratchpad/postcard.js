/* The feed post as a card. Checks the three things that make or break it:
   the corners are concentric, the controls are big enough to hit, and the ink on
   the pill is legible — plus that the card actually PAINTS, which is the bit a
   more specific rule silently stole the first time. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
const lum=(r,g,b)=>{const f=c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4);};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
const ratio=(a,b)=>{const L1=lum(...a),L2=lum(...b);const hi=Math.max(L1,L2),lo=Math.min(L1,L2);return (hi+.05)/(lo+.05);};
const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
// a small 3:2 JPEG so the photo box is filled edge to edge, not letterboxed
const PHOTO='data:image/png;base64,'+Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAADZbCibAAAAG0lEQVQI12P8//8/AzbAxIAD0EFi'+
  'FDGMKjmMSgIAcMYD/Zn6+ZQAAAAASUVORK5CYII=','base64').toString('base64');
(async()=>{
  /* A FRESH account per theme. Reusing one meant the first run recorded feed
     impressions and the second was served different posts by the already-seen filter —
     the Light pass simply never got a photo, which reads as a failure in the code. */
  const mkUser=async()=>{
    const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
    const h='pc'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('P',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
    const tk=auth.signToken({id:rows[0].id,email,is_admin:false});
    await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(tk).digest('hex'),rows[0].id]);
    /* Seed our OWN photo post rather than hoping the ranker serves one: only 158 of
       250k posts carry an image, so which run gets a photo was pure luck. Read in the
       FOLLOWING scope, which serves your own posts newest-first — For You is
       engagement-ranked and buries a post with no likes. */
    const {rows:pr}=await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at)
      VALUES ($1,'Card probe — a post with a photo',$2,600,400,true,now()),
             ($1,'Card probe — the post below it',$2,600,400,true,now()-interval '1 minute')
      RETURNING id`,[rows[0].id,PHOTO]);
    /* Two posts, so there is a GAP to measure, and some likes on the first so the
       counts actually render — a post with zero of everything shows no numbers, which
       is not the same thing as the redesign having dropped them. */
    await pool.query(`INSERT INTO post_likes (post_id,user_id)
      SELECT $1,id FROM users WHERE id <> $2 ORDER BY id LIMIT 7 ON CONFLICT DO NOTHING`,[pr[0].id,rows[0].id]);
    return tk;};
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const theme of ['black','light']) {
    const t=await mkUser();
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(6500);
    await p.evaluate(()=>acSetFeed('following'));
    await p.waitForTimeout(2500);
    /* Wait for a post that actually HAS a photo — the feed is ranked, so which posts
       arrive first varies between runs, and "no photo yet" is a slow feed, not a bug. */
    try { await p.waitForFunction(()=>!!document.querySelector('#acFeed .ac-post .ac-post-img'), null, {timeout:15000}); }
    catch(_) { await p.evaluate(()=>{const f=document.getElementById('acFeed'); if(f) f.scrollTop=f.scrollHeight;}); await p.waitForTimeout(3000); }
    console.log('\n── '+theme+' ──');

    const r=await p.evaluate(()=>{
      const post=[...document.querySelectorAll('#acFeed .ac-post')].find(e=>e.querySelector('.ac-post-img'));
      if(!post) return {none:true};
      const row=getComputedStyle(post), card=getComputedStyle(post,'::before');
      const img=post.querySelector('.ac-post-img'), acts=[...post.querySelectorAll('.ac-post-actions>*')];
      const rowB=post.getBoundingClientRect(), imgB=img.getBoundingClientRect();
      const num=v=>parseFloat(v)||0;
      const cardL=rowB.left+num(card.left), cardR=rowB.right-num(card.right);
      const a0=acts[0], aB=a0.getBoundingClientRect(), aPre=getComputedStyle(a0,'::before');
      const hit=el=>{const bb=el.getBoundingClientRect(), pe=getComputedStyle(el,'::before');
        return {w:Math.round(bb.width-num(pe.left)-num(pe.right)), h:Math.round(bb.height-num(pe.top)-num(pe.bottom))};};
      const posts=[...document.querySelectorAll('#acFeed .ac-post')];
      return {
        cardR:num(card.borderRadius), pad:num(row.paddingTop), cardBg:card.backgroundColor,
        bodyBg:getComputedStyle(document.body).backgroundColor,
        appCardBg:(()=>{const d=document.createElement('div');
          d.style.cssText='position:absolute;left:-9999px;background:var(--s2)';
          document.body.appendChild(d); const c=getComputedStyle(d).backgroundColor; d.remove(); return c;})(),
        imgR:num(getComputedStyle(img).borderRadius),
        imgInsetL:Math.round(imgB.left-cardL), imgInsetR:Math.round(cardR-imgB.right),
        gutterL:Math.round(cardL), gutterR:Math.round(innerWidth-cardR),
        gutterTok:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--feed-gutter'))||0,
        pillH:Math.round(aB.height), pillR:Math.min(num(getComputedStyle(a0).borderRadius), aB.height/2),
        pillBg:getComputedStyle(a0).backgroundColor, pillInk:getComputedStyle(a0).color,
        hits:acts.map(hit), nActs:acts.length,
        gap:posts.length>1 ? Math.round((posts[1].getBoundingClientRect().top+num(getComputedStyle(posts[1],'::before').top))
                                        -(posts[0].getBoundingClientRect().bottom-num(getComputedStyle(posts[0],'::before').bottom))) : null,
        rowOpaque:row.backgroundColor, hairline:getComputedStyle(post,'::after').content,
        counts:acts.map(e=>(e.textContent||'').trim()).filter(Boolean),
        /* The header is deliberately UNCHANGED (owner): relative time and the ⋯ stay
           where they were. The mockup showed an absolute date and no ⋯; both were
           overruled, so this fails if either creeps in. */
        headKids:[...post.querySelector('.ac-post-head').children].map(e=>e.className), moreInTop:!!post.querySelector('.ac-post-top .ac-post-more'), moreInIdcol:!!(post.querySelector('.ac-post-idcol .ac-post-more')), topKids:[...(document.querySelector('#acFeed .ac-post .ac-post-top')||{children:[]}).children].map(e=>String(e.className)),
        timeTxt:(post.querySelector('.ac-post-time')||{}).textContent||'',
      };
    });
    if (r.none) { ok(false,'a post with a photo rendered'); await p.close(); continue; }

    ok(r.cardBg && r.cardBg!=='rgba(0, 0, 0, 0)' && ratio(rgb(r.cardBg), rgb(r.bodyBg))>1.05,
       'the card actually paints', 'card '+r.cardBg+' vs page '+r.bodyBg+' = '+ratio(rgb(r.cardBg),rgb(r.bodyBg)).toFixed(2)+':1');
    /* THE POINT OF THE CARD'S COLOUR IS THAT IT IS THE APP'S, not that it clears some
       contrast floor I invented. The founder saw the post card (rgb 28,28,29) sitting
       directly above a Who-to-follow card (rgb 20,20,21) and called it out; the card now
       references --s2, the surface all 384 other card usages are made of. Comparing the
       two resolved colours is what stops them drifting apart again. */
    ok(r.cardBg === r.appCardBg, 'and it is the same grey every other card in the app uses',
       'post card '+r.cardBg+'  vs the app’s card surface '+r.appCardBg);
    /* Concentric by construction: a shape inset by the card's padding hugs the card's
       corner exactly when its radius is the card radius minus that padding. */
    ok(Math.abs(r.imgR-(r.cardR-r.pad))<0.6, 'the photo’s corner is concentric with the card’s',
       'card '+r.cardR+' − pad '+r.pad+' = '+(r.cardR-r.pad)+', photo '+r.imgR);
    ok(Math.abs(r.pillR-(r.cardR-r.pad))<0.6, 'and so is the action pill’s',
       'want '+(r.cardR-r.pad)+', pill '+r.pillR+' (height '+r.pillH+')');
    ok(r.imgInsetL===r.pad && r.imgInsetR===r.pad, 'the photo is inset by exactly the card padding', r.imgInsetL+' / '+r.imgInsetR+' vs '+r.pad);
    ok(r.gutterL===r.gutterTok && r.gutterR===r.gutterTok, 'the card sits on the app’s own gutter ('+r.gutterTok+'px), evenly on both sides', r.gutterL+' / '+r.gutterR+'  token '+r.gutterTok);
    ok(r.gap>=10 && r.gap<=14, 'even gap between cards', r.gap+'px');
    ok(r.hairline==='none'||r.hairline==='', 'the old hairline between posts is gone', r.hairline);
    /* The row behind the card must stay OPAQUE or the tab menu shows through the
       gutters as the feed rides up over it. */
    ok(rgb(r.rowOpaque).length===3 && !/rgba\(.*,\s*0\)/.test(r.rowOpaque),
       'the row behind the card is still opaque (the feed-cover mechanic)', r.rowOpaque);
    const under=r.hits.filter(o=>o.w<44||o.h<44);
    ok(under.length===0, 'every action meets the 44pt touch minimum', JSON.stringify(r.hits));
    /* The pill used to be a step ABOVE the card and the floor was 1.28. The owner had it
       inverted — it is now the quietest step that still reads (the page colour on Black),
       so the floor drops to 1.10. It is a floor, not a target: what matters is only that
       the pill does not vanish into the card.
       Contrast RATIO still understates a step at the light end
       (equal ratios read as bigger steps the brighter the pair), so demanding Black's
       1.95 in Light would force a pill dark enough to look like a blot on white. */
    ok(ratio(rgb(r.pillBg), rgb(r.cardBg))>1.10, 'the pill reads apart from the card',
       'pill '+r.pillBg+' on card '+r.cardBg+' = '+ratio(rgb(r.pillBg),rgb(r.cardBg)).toFixed(2)+':1');
    /* --t3 measures 2.2:1 on the mockup's pill grey. The count is 13px text: 4.5:1. */
    ok(ratio(rgb(r.pillInk), rgb(r.pillBg))>=4.5, 'and the icon + count are legible on it',
       'ink '+r.pillInk+' on '+r.pillBg+' = '+ratio(rgb(r.pillInk),rgb(r.pillBg)).toFixed(2)+':1');
    ok(r.counts.length>0, 'the counts survived the redesign', JSON.stringify(r.counts));
    /* The founder's mockup dropped the ⋯ entirely; it must stay, because report / mute /
       not-interested live behind it. It sits in the .ac-post-meta cluster now (with the
       timestamp), so this asks that it is SOMEWHERE in the header row rather than naming
       a parent — and separately that it is NOT inside .ac-post-idcol, which is the real
       regression: that column has a fixed height, and nesting the ⋯ there is what crushed
       the @handle to nothing in build 1746. */
    ok(r.moreInTop && !r.moreInIdcol,
       'the ⋯ stays in the header row, and outside the fixed-height name column',
       'in header '+r.moreInTop+', in name column '+r.moreInIdcol);
    ok(/^\s*(now|\d+[smhdw])\s*$/.test(r.timeTxt), 'and the time stays relative, not an absolute date', JSON.stringify(r.timeTxt));

    await p.screenshot({path:SP+'icons/CARD-'+theme+'.png'});
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
