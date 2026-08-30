/* ONE margin, app-wide. Every page you navigate INTO must start its content on the same
   line as a Home post card — 14px on a phone — and end on it at the other side. They used
   to sit at 24 (the sheet overlay's 10 plus the card's own 14), i.e. 20px narrower than
   Home, which the founder read as "everything is more in the middle".

   TWO deliberate exceptions, and both are asserted here so a future change cannot quietly
   take them with it:
     - the START page (Continue with Email / Google / Apple) keeps its own wider inset;
       the founder asked for that one screen to stay exactly as it was.
     - pop-ups — menus, confirms, pickers, intro sheets — are NOT pages and keep the base
       .overlay padding. Stretching a small "Are you sure?" box edge to edge makes a slab.

   It scans REAL PIXELS. Boxes lie on this question: a chevron centred inside a big
   invisible tap button sits ~19px further in than its own box, and an 11px square turned
   45 degrees reaches 2.3px PAST its box — which is the difference between an arrow that
   lines up with the title under it and one that does not. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP=__dirname+'/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
const PHOTO=require(SP+'mkpng.js')(640,400,[74,96,124]);
const GUT=14;                       // the phone gutter (--feed-gutter under 768px)
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};

/* Per ROW the pixel just inside the edge IS that surface's own background. Content is the
   first x that differs from it. Two traps, both hit for real while writing this:
   column 0 samples 18,18,18 where the page is truly 0,0,0 (a browser edge artifact), so
   the reference is taken at x=2; and a SUM of the channel diffs is the wrong measure —
   a Home post card is 20,20,22 on black, 62 in sum, which sits on a 60 threshold and got
   skipped, so the scan reported the PHOTO inside the card as the page margin. Compare the
   largest single-channel difference. */
function ink(png, y0, y1, side){
  const H=Math.min(y1*2,png.height), W=png.width;
  const at=(x,y)=>{const i=(W*y+x)<<2;return [png.data[i],png.data[i+1],png.data[i+2]];};
  const scanX = side==='l' ? [...Array(W-4).keys()].map(i=>i+4)
                           : [...Array(W-4).keys()].map(i=>W-5-i);
  const refX  = side==='l' ? 2 : W-3;
  for(const x of scanX){
    for(let y=y0*2;y<H;y++){
      const r=at(refX,y), c=at(x,y);
      if(Math.max(Math.abs(c[0]-r[0]),Math.abs(c[1]-r[1]),Math.abs(c[2]-r[2]))>=10)
        return +((side==='l'?x:W-1-x)/2).toFixed(1);
    }
  }
  return null;
}
(async()=>{
  const mk=async n=>{const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
    const u='gt'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,verified,account_type)
      VALUES ($1,$2,$3,$4,true,true,true,'business') RETURNING id`,[n,e,h,u]); return {id:rows[0].id,u};};
  const me=await mk('Gutter Probe'), other=await mk('Cornerstone Co Group');
  const t=auth.signToken({id:me.id,email:'x',is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),me.id]);
  await pool.query('INSERT INTO follows (follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[me.id,other.id]);
  await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at)
    VALUES ($1,'Networking really is just being genuinely curious about people.',$2,640,400,true,now())`,[other.id,PHOTO]);

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
    localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6500);

  /* LEFT is measured as real ink, because that is where the failure lives: a chevron
     centred in a big invisible tap box sits ~19px inside its own box. RIGHT is measured
     from the page container's CONTENT BOX instead — scanning ink on the right reports
     wherever a CENTRED empty-state message happens to end ("No invoices to pay." came
     back as 137px), which says nothing about the margin. That first version failed nine
     healthy pages. */
  const rightInset=async(sel)=>p.evaluate(s=>{
    /* The right margin is measured from a BOX, not from ink: scanning pixels from the
       right reports wherever a centred empty-state message happens to stop ("No invoices
       to pay." came back as 137px), which says nothing about the margin. Nine healthy
       pages failed that way before this was rewritten.
       Which box depends on the family. A sheet page IS its own container, so its content
       box is the margin. The settings family instead pads its container 2px narrower and
       gives every child a 2px margin — container 12 + child 2 = 14 — so there the visible
       CARD is the thing to measure, not the container it sits in. */
    const top=[...document.querySelectorAll('.overlay:not(.hidden)')].pop();
    const vis=e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();
      return c.display!=='none'&&c.visibility!=='hidden'&&+c.opacity!==0&&r.width>2&&r.height>2;};
    if(s==='postcard'){
      /* A feed post is a FULL-BLEED row whose visible card is a ::before inset by
         --post-edge, so the row's own box is at 0 and .ac-post-body is at 26 (the card
         plus its padding). Neither is the margin. */
      const e=document.querySelector('#acFeed .ac-post'); if(!e) return null;
      const edge=parseFloat(getComputedStyle(e).getPropertyValue('--post-edge'))||0;
      return +(innerWidth-e.getBoundingClientRect().right+edge).toFixed(1);
    }
    if(s==='card'){
      /* .iset-signout is in the list because a settings LEAF can render an empty group —
         Devices' list is filled asynchronously, so at 1.3s its .iset-group can still be
         zero-height and invisible, and the probe reported null on a correct page. */
      const g=[...(top||document).querySelectorAll('.iset-group,.iset-search,.iset-signout')].find(vis);
      return g?+(innerWidth-g.getBoundingClientRect().right).toFixed(1):null;
    }
    const el = s ? document.querySelector(s) : (top?top.querySelector('.job-card-modal'):null);
    if(!el) return null;
    const r=el.getBoundingClientRect(), pr=parseFloat(getComputedStyle(el).paddingRight)||0;
    return +(innerWidth-(r.right-pr)).toFixed(1);
  },sel);
  const check=async(name,y0,y1,want,rightSel)=>{
    const png=PNG.sync.read(await p.screenshot());
    const l=ink(png,y0,y1,'l');
    ok(l!==null && Math.abs(l-want)<=1, name+' — content starts at '+l+'px', 'want '+want);
    const r=await rightInset(rightSel===undefined?null:rightSel);
    ok(r!==null && Math.abs(r-want)<=1, name+' — and ends at '+r+'px from the other side', 'want '+want);
  };

  console.log('\n══ the line everything must meet ══');
  await p.evaluate(()=>acSetFeed('following')); await p.waitForTimeout(2600);
  await check('HOME post card', 300, 420, GUT, 'postcard');
  await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(2000);
  await check('ACCOUNT page', 120, 260, GUT, '#acMeBody .me-group');

  console.log('\n══ inside pages ══');
  const sheets=[['Wallet','acOpenWallet'],['Orders',"acOpenOrders('buyer')"],['Gift cards','acOpenGiftCards'],
    ['Invoices','acOpenInvoices'],['Quotes','acOpenQuotes'],['Events','acOpenEvents'],['Courses','acOpenCourses'],
    ['Referrals','acOpenReferrals'],['Marketplace','acOpenMarketplace'],['Agenda','acOpenAgenda'],
    ['Saved','acOpenSaved'],['Addresses','acOpenAddresses'],['Loyalty','acOpenLoyalty'],['Pools','acOpenPools'],
    ['Splits','acOpenSplits'],['Bookings','acOpenBookings'],['Services','acOpenServices'],['Team','acOpenTeam']];
  for(const [n,fn] of sheets){
    let opened=true;
    try{ await p.evaluate(f=>eval(f+(f.includes('(')?'':'()')),fn); }catch(e){ opened=false; }
    if(!opened){ ok(false,n+' — could not be opened'); continue; }
    await p.waitForTimeout(1500);
    await check(n, 6, 200, GUT);
    await p.evaluate(()=>{const o=[...document.querySelectorAll('.overlay:not(.hidden)')].pop(); if(o) closeOverlay(o.id);});
    await p.waitForTimeout(450);
  }

  console.log('\n══ settings, and its leaf sheets ══');
  await p.evaluate(()=>openSettings()); await p.waitForTimeout(1700);
  await check('Settings hub', 10, 260, GUT, 'card');
  await p.evaluate(()=>setNav('privacy')); await p.waitForTimeout(1300);
  await check('a Settings sub-page', 10, 260, GUT, 'card');
  for(const [n,fn] of [['Devices','openDevices'],['Change email','openChangeEmail'],['Language','acOpenLanguage']]){
    let opened=true;
    try{ await p.evaluate(f=>eval(f+'()'),fn); }catch(e){ opened=false; }
    if(!opened){ ok(false,n+' — could not be opened'); continue; }
    await p.waitForTimeout(1900);
    await check(n, 10, 220, GUT, 'card');
    await p.evaluate(()=>{const o=[...document.querySelectorAll('.overlay.set-fs:not(.hidden)')].pop(); if(o) closeOverlay(o.id);});
    await p.waitForTimeout(400);
  }
  await p.close();

  console.log('\n══ signed out: the wizard widens, the START page does not ══');
  const q=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  q.on('pageerror',e=>errs.push(String(e).slice(0,110)));
  await q.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await q.evaluate(()=>localStorage.clear());
  await q.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await q.waitForTimeout(5200);
  const startPad=await q.evaluate(()=>{const el=document.querySelector('.auth-inner');
    return el?parseFloat(getComputedStyle(el).paddingLeft):null;});
  ok(startPad===20, 'the START page keeps its own 20px — the one screen asked to stay put',
     'padding '+startPad);
  await q.evaluate(()=>document.querySelector('#loginOverlay .auth-btn-primary')?.click());
  await q.waitForTimeout(1400);
  const stepPad=await q.evaluate(()=>{const el=document.querySelector('.auth-step:not(.hidden)');
    return el?parseFloat(getComputedStyle(el).paddingLeft):null;});
  ok(stepPad===GUT, 'a sign-up STEP is on the app margin', 'padding '+stepPad);
  const band=await q.evaluate(()=>{const a=document.querySelector('.auth-step:not(.hidden) .auth-backarrow');
    if(!a) return null; const r=a.getBoundingClientRect();
    return {t:Math.round(r.top), b:Math.round(r.bottom), box:+r.left.toFixed(1)};});
  let mark=null;
  if(band){ mark=ink(PNG.sync.read(await q.screenshot()), band.t, band.b, 'l'); }
  ok(mark!==null && Math.abs(mark-GUT)<=1.5,
     'the wizard back arrow: the MARK is on the margin, not its invisible tap box',
     band?('mark at '+mark+', its tap box at '+band.box):'not found');
  await q.close();

  console.log('\n══ pop-ups are NOT pages and must be left alone ══');
  const r=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  r.on('pageerror',e=>errs.push(String(e).slice(0,110)));
  await r.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await r.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
    localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await r.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await r.waitForTimeout(6500);
  /* Naming them is deliberate. The first version asked "is any non-page overlay now at
     0?" and flagged four — userFeedOverlay, postVideoView, groupPreviewOverlay,
     feedComposeOverlay — which are immersive FULL-SCREEN surfaces that were edge to edge
     long before this change. Diffing every overlay's padding against the committed file
     settled it: 317 changed, all of them inside pages going 10 -> 0, and not one pop-up.
     So the check is a named list of things that must keep their space, not a blanket rule
     a full-bleed surface can trip. */
  const POPUPS={confirmOverlay:20, plansOverlay:20, ownPostActions:20, introSheet:16,
                loginOverlay:20, signupOverlay:20};
  const pops=await r.evaluate(want=>Object.keys(want).map(id=>{
    const o=document.getElementById(id);
    return {id, pad:o?parseFloat(getComputedStyle(o).paddingLeft):null};
  }), POPUPS);
  for(const {id,pad} of pops)
    ok(pad===POPUPS[id], 'the pop-up '+id+' keeps its own space, not the page margin',
       'padding '+pad+', want '+POPUPS[id]);
  await r.close();

  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
