/* The feed has ONE corner vocabulary and nothing is allowed outside it:
     • a CARD is --post-card-r (30)
     • anything inside a card — a photo, an action pill — is --post-inner-r (18)
     • everything else is a full capsule or a circle (radius = half its own short side)
   The owner photographed a sponsored ad sitting next to a post: the ad was an 18px card
   with its photo flush to the edge, the post a 30px card with an 18px photo. This locks
   the ad, the who-to-follow card and every other rounded thing in the feed to that set. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
const PHOTO=require(SP+'mkpng.js')(600,400,[86,104,132]);
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='ad'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('AdCard',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  for(let i=0;i<9;i++) await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at) VALUES ($1,$2,$3,600,400,true,now() - ($4||' seconds')::interval)`,[uid,'Ad probe post '+i,PHOTO,i]);
  // the in-feed announcement bar is a card in the feed too — seed one so the stray-radius
  // invariant below actually sees it
  await pool.query(`DELETE FROM announcements WHERE message LIKE 'Radius probe%'`);
  await pool.query(`INSERT INTO announcements (message,style,audience,active) VALUES ('Radius probe announcement','info','all',true)`);
  await pool.query(`DELETE FROM ad_campaigns WHERE sponsor_name='AdCardProbe'`);
  await pool.query(`INSERT INTO ad_campaigns (advertiser_id,sponsor_name,title,body,media,media_kind,cta_label,dest_url,status,days,amount_cents,paid,starts_at,ends_at)
    VALUES ($1,'AdCardProbe','Find your dream home','Browse brand-new listings in your area this week.',$2,'image','View homes','https://example.com','active',7,500,true,now(),now()+interval '7 days')`,[uid,PHOTO]);

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
    await p.waitForTimeout(3000);
    /* the ad sits well below the fold and its photo is lazy — measure it on screen, or
       the box reads 0 tall and the radius clamps to 0 (this probe reported that once) */
    await p.evaluate(()=>{const a=document.querySelector('#acFeed .ac-adcard'); if(a) a.scrollIntoView({block:'center'});});
    await p.waitForFunction(()=>{const i=document.querySelector('#acFeed .ac-adcard img'); return i&&i.complete&&i.naturalWidth>0;},{timeout:8000}).catch(()=>{});
    await p.waitForTimeout(700);

    const r=await p.evaluate(()=>{
      /* EFFECTIVE radius: a capsule declares 999px and renders at half its height, a
         circle declares 50%. Comparing declared values calls identical curves different. */
      const eff=(e,ps)=>{if(!e)return null;const bb=e.getBoundingClientRect(),cs=getComputedStyle(e,ps||null);
        const parts=cs.borderRadius.split('/')[0].trim().split(/\s+/);
        const vals=parts.map(d=>d.endsWith('%')?(parseFloat(d)/100)*Math.min(bb.width,bb.height):parseFloat(d)).filter(x=>!isNaN(x));
        return +Math.min(Math.max(...vals,0), bb.height/2, bb.width/2).toFixed(1);};
      const feed=document.getElementById('acFeed');
      const ad=feed.querySelector('.ac-adcard'), post=feed.querySelector('.ac-post');
      if(!ad||!post) return {missing:true,hasAd:!!ad,hasPost:!!post};
      const adImg=ad.querySelector('.ac-ad-media'), postImg=post.querySelector('.ac-post-img');
      const box=e=>{const b=e.getBoundingClientRect();return {x:Math.round(b.x),w:Math.round(b.width),t:Math.round(b.top),bot:Math.round(b.bottom)};};
      // the gap an ad leaves its neighbours vs the gap two posts leave each other
      const kids=Array.from(feed.children).filter(e=>e.classList.contains('ac-post')||e.classList.contains('ac-adcard'));
      const adIdx=kids.indexOf(ad);
      const gapAfter=(i)=>{const a=kids[i],c=kids[i+1]; if(!a||!c)return null;
        const ab=getComputedStyle(a,'::before').getPropertyValue('bottom'); // not used; measure real boxes
        const r1=a.getBoundingClientRect(), r2=c.getBoundingClientRect();
        return Math.round(r2.top - (r1.bottom - parseFloat(getComputedStyle(a).getPropertyValue('--post-gap'))));};
      // every rounded thing in the feed, with its own short side
      const stray=[];
      feed.querySelectorAll('*').forEach(e=>{
        const bb=e.getBoundingClientRect(); if(bb.width<6||bb.height<6) return;
        const v=eff(e); if(!v) return;
        const half=+(Math.min(bb.width,bb.height)/2).toFixed(1);
        if(Math.abs(v-30)<.6||Math.abs(v-18)<.6||Math.abs(v-half)<.6) return;
        stray.push((e.tagName.toLowerCase()+'.'+String(e.className||'').trim().split(/\s+/).slice(0,2).join('.'))+' r='+v+' '+Math.round(bb.width)+'x'+Math.round(bb.height));});
      const sgc=feed.querySelector('.ac-sgc'), ann=feed.querySelector('.ac-annbar:not(.hidden)');
      return {
        adCardR:eff(ad,'::before'), postCardR:eff(post,'::before'),
        adCardBg:getComputedStyle(ad,'::before').backgroundColor,
        postCardBg:getComputedStyle(post,'::before').backgroundColor,
        adImgR:eff(adImg), postImgR:eff(postImg),
        adImgBox:adImg?box(adImg):null, postImgBox:postImg?box(postImg):null,
        ctaR:eff(ad.querySelector('.ac-ad-cta')), pillR:eff(post.querySelector('.ac-post-actions>*')),
        moreR:eff(post.querySelector('.ac-post-more')), moreBox:box(post.querySelector('.ac-post-more')),
        sgcR:sgc?eff(sgc):null, annR:ann?eff(ann):null,
        annDeclared:ann?getComputedStyle(ann).borderRadius.split('/')[0].trim().split(/\s+/)[0]:null,
        annH:ann?Math.round(ann.getBoundingClientRect().height):null, cardTok:getComputedStyle(document.documentElement).getPropertyValue('--post-card-r').trim(),
        gapAdBelow:gapAfter(adIdx), gapPostPost:gapAfter(adIdx>1?0:2),
        cover:document.body.classList.contains('feed-cover'),
        stray:stray.slice(0,12), strayN:stray.length,
        sgcX:document.querySelectorAll('.ac-sgc-x').length,
      };});

    if(r.missing){ ok(false,'an ad and a post are both in the feed',JSON.stringify(r)); await p.close(); continue; }
    console.log('     ad card '+r.adCardR+' / post card '+r.postCardR+'   ad photo '+r.adImgR+' / post photo '+r.postImgR);
    console.log('     ad photo box '+JSON.stringify(r.adImgBox)+'  post photo box '+JSON.stringify(r.postImgBox));

    ok(r.adCardR===r.postCardR, 'the sponsored ad and a post are the same card corner ('+r.adCardR+')', 'ad '+r.adCardR+' post '+r.postCardR);
    ok(Math.abs(r.adCardR-30)<.6, 'that corner is --post-card-r, i.e. the nav bar\'s 30', r.adCardR);
    ok(r.adCardBg===r.postCardBg, 'the ad card is the same fill as a post card', r.adCardBg+' vs '+r.postCardBg);
    /* the cover rule black-fills every DIRECT child of #acFeed so the rising feed hides the
       tab menu; a card painted as a plain background is erased by it, a ::before is not */
    ok(r.cover && r.adCardBg!=='rgb(0, 0, 0)' && r.adCardBg!=='rgba(0, 0, 0, 0)',
       'the ad still has a card while the feed is covering the tab menu (browser tab)', r.adCardBg);
    ok(Math.abs(r.adImgR-r.postImgR)<.6, 'the ad photo turns on the same corner as a post photo ('+r.adImgR+')', r.adImgR+' vs '+r.postImgR);
    ok(Math.abs(r.adImgR-18)<.6, 'that corner is --post-inner-r (card 30 minus its 12 padding)', r.adImgR);
    ok(r.adImgBox && r.postImgBox && r.adImgBox.w===r.postImgBox.w && r.adImgBox.x===r.postImgBox.x,
       'the ad photo is exactly as wide, and starts exactly where, a post photo does', JSON.stringify(r.adImgBox)+' vs '+JSON.stringify(r.postImgBox));
    ok(Math.abs(r.ctaR-r.pillR)<.6, 'the ad\'s CTA pill matches a post\'s action pill ('+r.ctaR+')', r.ctaR+' vs '+r.pillR);
    ok(r.gapAdBelow!==null && r.gapPostPost!==null && Math.abs(r.gapAdBelow-r.gapPostPost)<1.5,
       'an ad sits as far from its neighbour as two posts sit from each other', r.gapAdBelow+' vs '+r.gapPostPost);
    ok(Math.abs(r.sgcR-30)<.6, 'the who-to-follow card is a card too, at 30', r.sgcR);
    ok(r.annDeclared===r.cardTok, 'the in-feed announcement bar declares the card radius ('+r.annDeclared+'; a '+r.annH+'px bar then renders it as a capsule)', r.annDeclared+' vs '+r.cardTok);
    ok(r.moreBox.w>0 && Math.abs(r.moreR-r.moreBox.w/2)<1.0, 'the post header\'s ... is a circle, not a 6px square', r.moreR+' box '+JSON.stringify(r.moreBox));
    ok(r.sgcX===0, 'a who-to-follow card has no per-card \u2715 (owner removed it)', r.sgcX+' found');
    ok(r.strayN===0, 'every rounded thing in the feed is a 30 card, an 18 inner shape, or a full capsule/circle', r.stray.join(' | '));
    ok(errs.length===0, 'no page errors', errs.join(' | '));
    await p.close();
  }
  await b.close(); await pool.end();
  console.log('\n'+(fail?'':'')+'═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
