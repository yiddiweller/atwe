/* ONE radius system. When you scroll, the nav bar and the + button overlap the post
   cards, so their corners are compared side by side — they must be the same curve.
   Everything INSIDE the card turns on the card's radius minus its padding, so the photo,
   the action pills and the avatar all agree with each other and hug the card's corner. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,280):''));}};
const PHOTO='data:image/png;base64,'+Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAADZbCibAAAAG0lEQVQI12P8//8/AzbAxIAD0EFi'+'FDGMKjmMSgIAcMYD/Zn6+ZQAAAAASUVORK5CYII=','base64').toString('base64');
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='rd'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('R',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at) VALUES ($1,'Radius probe',$2,600,400,true,now())`,[uid,PHOTO]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6500);
  await p.evaluate(()=>acSetFeed('following'));
  await p.waitForTimeout(2500);

  await p.evaluate(()=>{
    document.body.classList.remove('nav-morph','nav-ball');
    const f=document.getElementById('acHomeFab');
    if(f){ f.style.transition='none'; f.style.transform='none'; f.style.scale='1'; }
  });
  await p.waitForTimeout(700);
  const r=await p.evaluate(()=>{
    /* EFFECTIVE radius, not the declared one: a capsule declares 999px and renders at
       half its height, and a circle declares 50%. Comparing declared values would call
       a pill and a card different when they curve identically. */
    const eff=(sel,pseudo)=>{const e=document.querySelector(sel); if(!e) return null;
      const bb=e.getBoundingClientRect(), cs=getComputedStyle(e,pseudo||null);
      let dec=cs.borderRadius.split(' ')[0];
      let v = dec.endsWith('%') ? (parseFloat(dec)/100)*Math.min(bb.width,bb.height) : parseFloat(dec);
      return {r:+Math.min(v||0, bb.height/2, bb.width/2).toFixed(1), w:Math.round(bb.width), h:Math.round(bb.height)};};
    // the + button lives on the feed but is hidden on some surfaces — measure it directly
    const fab=(()=>{const e=document.querySelector('.ac-fab'); if(!e) return null;
      const cs=getComputedStyle(e); const w=parseFloat(cs.width), hh=parseFloat(cs.height);
      return {r:+Math.min(w,hh).toFixed(1)/2, w:Math.round(w), h:Math.round(hh)};})();
    return {
      nav: eff('.bottom-nav'), fab,
      card: eff('#acFeed .ac-post','::before'),
      photo: eff('#acFeed .ac-post-img'),
      pill: eff('#acFeed .ac-post .ac-post-actions>*'),
      avatar: eff('#acFeed .ac-post .user-avatar'),
      pad: parseFloat(getComputedStyle(document.querySelector('#acFeed .ac-post')).paddingTop),
      // the top bar's round buttons — the "+" the owner photographed sitting on a card
      plus: eff('#tbBrandPlus'), more: eff('#tbBrandMore'), prof: eff('#tbBrandProf'),
      /* Matching CURVES is only half of it — the shapes also have to start on the same
         line, or a card's edge peeks out past the bar riding over it. The owner called
         that "almost perfect, but not perfect": the bar was inset 5px more than a card. */
      edges: (()=>{const q=s=>{const e=document.querySelector(s);return e?e.getBoundingClientRect():null;};
        const card=q('#acFeed .ac-post'), nav=q('.bottom-nav'), fabEl=document.querySelector('.ac-fab');
        const gut=parseFloat(getComputedStyle(document.querySelector('#acFeed .ac-post')).getPropertyValue('--post-edge'))||0;
        const homeFab=document.getElementById('acHomeFab');
        const fabEl2=(homeFab && homeFab.getBoundingClientRect().width)?homeFab:fabEl;
        const fb=fabEl2?fabEl2.getBoundingClientRect():null;
        /* the compose + is not painted on every scope, so fall back to its own computed
           `right` rather than letting the check pass vacuously on a 0-wide box */
        const fabRight = fb&&fb.width ? window.innerWidth-fb.right
                       : (fabEl2?parseFloat(getComputedStyle(fabEl2).right):null);
        const fabMeasured = !!(fb&&fb.width);
        const pf=q('#tbBrandProf');
        return card&&nav?{profGap:pf?+(window.innerWidth-pf.right).toFixed(1):null,
          cardL:+(card.left+gut).toFixed(1), cardR:+(card.right-gut).toFixed(1),
          navL:+nav.left.toFixed(1), navR:+nav.right.toFixed(1),
          fabGap:fabRight===null||isNaN(fabRight)?null:+fabRight.toFixed(1), fabMeasured,
          gut:+gut.toFixed(1)}:null;})(),
      /* A circle only hugs a rounded corner when its centre IS the corner's centre — i.e.
         when it is inset by the padding on BOTH axes. The avatar sat 15.7 from the top and
         12 from the left, so the gap to the curve was uneven. */
      avInset: (()=>{const po=document.querySelector('#acFeed .ac-post'); if(!po) return null;
        const a=po.querySelector('.user-avatar'); if(!a) return null;
        const pb=po.getBoundingClientRect(), ab=a.getBoundingClientRect();
        const gut=parseFloat(getComputedStyle(po).getPropertyValue('--post-edge'))||0;
        return {l:+(ab.left-(pb.left+gut)).toFixed(1), t:+(ab.top-pb.top).toFixed(1)};})(),
    };
  });
  const show=(k,v)=>console.log('     '+k.padEnd(14)+(v?String(v.w)+'x'+String(v.h)+'  radius '+v.r:'(not found)'));
  ['nav','fab','card','photo','pill','avatar','plus','more','prof'].forEach(k=>show(k,r[k]));
  console.log('     card padding   '+r.pad);

  ok(r.nav && r.fab && r.card, 'the nav bar, the + button and a post card are all on screen');
  /* The three shapes that overlap when you scroll must turn on the SAME corner. */
  ok(r.card.r===r.nav.r, 'the post card turns on the nav bar’s own corner', 'card '+r.card.r+'  nav '+r.nav.r);
  ok(r.fab.r===r.nav.r, 'and so does the + button', '+ '+r.fab.r+'  nav '+r.nav.r);
  /* Everything inside the card is card − padding, so each hugs the card's corner. */
  const inner = r.card.r - r.pad;
  ok(r.photo.r===inner, 'the photo turns on card − padding', 'photo '+r.photo.r+'  want '+inner);
  ok(r.pill.r===inner, 'the action pills too', 'pill '+r.pill.r+'  want '+inner+' (height '+r.pill.h+')');
  ok(r.avatar.r===inner, 'and the profile picture', 'avatar '+r.avatar.r+'  want '+inner);
  /* The top bar's round buttons ride OVER the cards as the feed scrolls up under them —
     that is the "+" in the owner's screenshot. They are 36px circles, so radius 18, which
     is card − padding: the small shapes and the big ones are one system, related by the
     same rule that keeps the inside of a card concentric with it. */
  ok(r.plus && r.plus.r===inner, 'the top bar’s + turns on the same corner', r.plus?('+ '+r.plus.r+'  want '+inner):'not found');
  ok(r.more && r.more.r===inner, 'so does the \u22ef', r.more?('\u22ef '+r.more.r):'not found');
  ok(r.prof && r.prof.r===inner, 'and the profile button', r.prof?('profile '+r.prof.r):'not found');
  const e=r.edges;
  console.log('     card '+ (e?e.cardL+'..'+e.cardR:'?') + '   nav '+(e?e.navL+'..'+e.navR:'?')+'   + inset '+(e?e.fabGap:'?')+'   gutter '+(e?e.gut:'?'));
  /* They must NOT share a line. Build 1742 made the bar and the cards line up exactly and
     the owner read it as the bar "touching" the posts; the bar is deliberately narrower so
     the cards visibly pass outside it. Equal insets on both sides, and the same amount at
     each end, so the bar still reads as centred rather than nudged. */
  const inset = e ? +((e.navL - e.cardL)).toFixed(1) : null;
  const insetR = e ? +((e.cardR - e.navR)).toFixed(1) : null;
  ok(inset !== null && inset > 4 && Math.abs(inset - insetR) < 0.6,
     'the nav bar sits INSIDE the cards, by the same amount at both ends ('+inset+'px)',
     e?('left gap '+inset+'  right gap '+insetR):'no boxes');
  ok(r.card && r.nav && r.card.r===r.nav.r,
     'and it still turns on the very same corner while doing it', r.card?('card '+r.card.r+'  nav '+r.nav.r):'');
  /* the compose + belongs to the CONTENT, so it tracks the cards' gutter, not the bar */
  ok(e && e.fabMeasured, 'the + button was measured where it actually LANDS, not from its CSS',
     e?('measured: '+e.fabMeasured):'');
  ok(e && e.fabGap!==null && Math.abs(e.fabGap-e.gut)<0.6,
     'the + button lines up with the cards, not with the bar', e?('+ '+e.fabGap+'  gutter '+e.gut):'');
  /* the owner chose: the top bar's + / \u22ef / photo follow the CARDS, so the whole
     content column shares one start line and the bar is the only thing set apart */
  ok(e && e.profGap!==null && Math.abs(e.profGap-e.gut)<0.6,
     'the top bar\u2019s photo ends on the cards\u2019 line too', e?('photo '+e.profGap+'  gutter '+e.gut):'');
  ok(r.avInset && Math.abs(r.avInset.l-r.pad)<0.6 && Math.abs(r.avInset.t-r.pad)<0.6,
     'the profile picture is concentric with the card\u2019s corner \u2014 inset by the padding on BOTH axes',
     r.avInset?('left '+r.avInset.l+'  top '+r.avInset.t+'  want '+r.pad):'no avatar');
  ok(errs.length===0,'no JS errors',errs[0]);
  await p.screenshot({path:SP+'icons/RADII.png'});
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
