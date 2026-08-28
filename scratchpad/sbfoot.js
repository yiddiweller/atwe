/* The drawer's footer, after the owner's trim: no Pro row once you're Pro, Settings
   replaced by Account + Help & feedback (both a step quieter than the hub rows), and no
   copyright line. Drives the real drawer rather than reading the source, because two
   different media queries size .sb-settings and an override has to actually WIN. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const {PNG}=require(SP+'node_modules/pngjs');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};
const READ=`(()=>{
  const vis=el=>el&&getComputedStyle(el).display!=='none'&&el.offsetParent!==null;
  const sb=document.getElementById('sidebar');
  const rows=[...sb.querySelectorAll('.sb-btn,.sb-settings')].filter(vis).map(e=>{
    const cs=getComputedStyle(e);
    return {label:(e.innerText||'').trim().split('\\n')[0], cls:e.className,
      fs:parseFloat(cs.fontSize), pad:cs.padding,
      /* An icon here is EITHER an <svg> or a .sb-ico mask pair (the founder's own nav
         artwork). Looking only for svg silently returns null for the Account row and the
         size comparison stops meaning anything. */
      ic:(()=>{const g=e.querySelector('svg,.sb-ico');return g?Math.round(g.getBoundingClientRect().width):null;})(),
      icBox:(()=>{const g=e.querySelector('svg,.sb-ico');if(!g)return null;
        const r=g.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})(),
      navart:!!e.querySelector('.sb-ico .nv-off')};
  });
  return {rows, copy:!!document.querySelector('.sb-copy'),
    acct:!!document.getElementById('sbSettings2'), help:!!document.getElementById('sbHelp2')};
})()`;
(async()=>{
  const mk=async plan=>{const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
    const u='sf'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,plan)
      VALUES ('Foot Tester',$1,$2,$3,true,true,$4) RETURNING id`,[e,h,u,plan]);
    const t=auth.signToken({id:rows[0].id,email:e,is_admin:false});
    await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
      [crypto.createHash('sha256').update(t).digest('hex'),rows[0].id]);
    return t;};
  const tFree=await mk('free'), tPro=await mk('pro');
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  const open=async(p,t)=>{
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(7000);
    if (p.viewportSize().width<=768){ await p.evaluate(()=>toggleSidebar()); await p.waitForTimeout(800); }
    return p.evaluate(READ);
  };
  for (const [label,w] of [['phone',390],['icon rail',1280],['desktop',1400]]){
    console.log('\n══ '+label+' ══');
    // free account
    let p=await b.newPage({viewport:{width:w,height:900},deviceScaleFactor:2,hasTouch:w<800,isMobile:w<800});
    p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
    let r=await open(p,tFree);
    console.log('  free rows: '+JSON.stringify(r.rows.map(x=>x.label)));
    ok(r.rows.some(x=>/^pro$|upgrade to pro/i.test(x.label)),'free: the Pro row is offered');
    ok(!r.copy,'no © line anywhere in the sidebar');
    ok(r.acct&&r.help,'both footer rows exist in the DOM');
    const acct=r.rows.find(x=>/^account$/i.test(x.label));
    const help=r.rows.find(x=>/help/i.test(x.label));
    ok(!!acct,'the gear row now reads "Account"', acct&&acct.label);
    ok(!!help,'and "Help & feedback" sits under it', help&&help.label);
    ok(r.rows.some(x=>/^settings$/i.test(x.label)),'Settings is back in the drawer (owner)');
    // order matters: the owner asked for Settings directly UNDER Account
    const order=r.rows.map(x=>x.label).filter(l=>/^(account|settings|help & feedback)$/i.test(l));
    ok(JSON.stringify(order)===JSON.stringify(['Account','Settings','Help & feedback']),
       'and the footer reads Account -> Settings -> Help & feedback', JSON.stringify(order));
    if (acct&&help){
      // "a little smaller" = strictly below the hub rows, but not a different species
      const hub=r.rows.filter(x=>/collections|communities|circles|go live/i.test(x.label));
      const hubFs=hub.length?Math.max(...hub.map(x=>x.fs)):null, hubIc=hub.length?Math.max(...hub.map(x=>x.ic||0)):null;
      console.log('     hub '+hubFs+'px / icon '+hubIc+'   footer '+acct.fs+'px / icon '+acct.ic);
      /* Between 768 and 1282px the rail collapses to icons only (body.nav-mini, font-size
         0). "A step smaller" has nothing to say there — but the icons still sit in one
         column, so what matters is that they MATCH. */
      if (hubFs === 0){
        ok(acct.ic===hubIc,'icon rail: the footer icons are the same size as the hub icons',
           acct.ic+' vs '+hubIc);
        ok(true,'(no labels in the icon rail, so no size step to check)');
      } else {
        ok(hubFs!==null && acct.fs<hubFs && acct.fs>=hubFs*0.8,
           'the footer pair is a step smaller than the hub, not a different size class',
           acct.fs+' vs '+hubFs);
        ok(hubIc!==null && acct.ic<hubIc,'their icons step down too', acct.ic+' vs '+hubIc);
      }
      ok(acct.navart,'the Account row draws the real nav artwork, not a stand-in glyph',
         'nv mask present: '+acct.navart);
      const setr=r.rows.find(x=>/^settings$/i.test(x.label));
      /* Text size must match. Icon BOX deliberately does NOT: the three drawings
         overfill their box by different amounts, so equal boxes is exactly what
         made them look mismatched. Equal INK is asserted from real pixels below,
         where labels are shown; in the icon rail (no labels) equal boxes is right. */
      ok(setr && acct.fs===help.fs && acct.fs===setr.fs,'and all three share the text size',
         [acct,setr,help].map(x=>x?x.fs+'px':'-').join('  '));
      if (hubFs===0) ok(setr && acct.ic===help.ic && acct.ic===setr.ic,
         'icon rail: equal boxes there, since nothing else is on the row',
         [acct,setr,help].map(x=>x?x.ic:'-').join('/'));
    }
    /* The gap under the last row. env() cannot be simulated, so the real iPhone inset
       is injected and the app's OWN expression re-declared with it — hard-coding a
       final number here would just measure the number, not the rule. */
    if (w<=768){
      await p.addStyleTag({content:'#sidebar{padding-bottom:max(12px, calc(34px - 6px))!important}'});
      await p.waitForTimeout(250);
      const g=await p.evaluate(()=>{
        const sb=document.getElementById('sidebar');
        const rows=[...sb.querySelectorAll('.sb-settings,.sb-btn')].filter(e=>getComputedStyle(e).display!=='none');
        const last=rows[rows.length-1].getBoundingClientRect(), box=sb.getBoundingClientRect();
        return {gap:Math.round(box.bottom-last.bottom)};
      });
      console.log('     gap under the last row, with an iPhone inset: '+g.gap+'pt');
      /* 48 before (14 of ours ON TOP of the 34 iOS reserves). Floor is what keeps the
         row clear of the home indicator, which occupies roughly the bottom 21pt. */
      ok(g.gap<=30 && g.gap>=22,'the dead space under the last row is trimmed, not removed',
         g.gap+'pt (was 48)');
    }
    /* The three footer icons must READ the same size. They already shared a 22px
       box and still looked wrong: the founder's nav artwork carries its own
       padding, the gear fills its viewBox edge to edge. So this measures the real
       INK in a screenshot, not the box — the same lesson as the post action row. */
    const labelled = r.rows.some(x=>/collections/i.test(x.label) && x.fs>0);
    if (labelled){
      const sh=await p.screenshot(); const im=PNG.sync.read(sh); const d=im.width/w;
      const gp=(x,y)=>{const i=(im.width*y+x)<<2;return im.data[i]+im.data[i+1]+im.data[i+2];};
      const ink=[];
      for (const id of ['sbSettings2','sbSettingsRow','sbHelp2']){
        const bx=await p.evaluate(i=>{const g=document.getElementById(i).querySelector('svg,.sb-ico');
          const r=g.getBoundingClientRect();
          return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};},id);
        let a=1e9,z=-1,c=1e9,v=-1;
        for(let x=bx.x-5;x<bx.x+bx.w+5;x++) for(let y=bx.y-5;y<bx.y+bx.h+5;y++){
          if(gp(Math.round(x*d),Math.round(y*d))>150){ if(x<a)a=x; if(x>z)z=x; if(y<c)c=y; if(y>v)v=y; }
        }
        ink.push({id, w:z-a+1, h:v-c+1, x:a});
      }
      console.log('     footer icon INK: '+ink.map(i=>i.id+' '+i.w+'x'+i.h+' @x'+i.x).join('   '));
      const ws=ink.map(i=>i.w), hs=ink.map(i=>i.h), xs=ink.map(i=>i.x);
      ok(Math.max(...ws)-Math.min(...ws)<=2 && Math.max(...hs)-Math.min(...hs)<=2,
         'all three footer icons draw at the same size, not just in the same box',
         ink.map(i=>i.w+'x'+i.h).join(' / '));
      /* And they must line up down a single edge. Scaling an icon's WIDTH shrinks its
         layout box too, and flex then starts a narrower box's drawing — and its label —
         further left. transform:scale draws smaller without touching the box, so every
         row keeps one left edge. The founder spotted this zoomed in. */
      ok(Math.max(...xs)-Math.min(...xs)<=2,'and they line up down one left edge',
         xs.join(' / '));
      const labs=await p.evaluate(()=>['sbSettings2','sbSettingsRow','sbHelp2'].map(i=>{
        const e=document.getElementById(i);
        const n=[...e.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
        const r=document.createRange(); r.selectNode(n);
        return Math.round(r.getBoundingClientRect().left);}));
      ok(Math.max(...labs)-Math.min(...labs)<=1,'and so do their labels',labs.join(' / '));
    }
    // the Account row must actually go to the Account page
    if (w<=768){
      await p.evaluate(()=>document.getElementById('sbSettings2').click());
      await p.waitForTimeout(1600);
      const where=await p.evaluate(()=>({tab:typeof _appTab!=='undefined'?_appTab:null,
        drawer:document.getElementById('sidebar').classList.contains('open'),
        me:!!document.querySelector('#acMeScreen:not(.hidden)')}));
      ok(where.tab==='profile'&&!where.drawer,'tapping Account opens the Account page and closes the drawer',
         JSON.stringify(where));
    }
    await p.close();
    // pro account
    p=await b.newPage({viewport:{width:w,height:900},deviceScaleFactor:2,hasTouch:w<800,isMobile:w<800});
    p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
    r=await open(p,tPro);
    console.log('  pro rows:  '+JSON.stringify(r.rows.map(x=>x.label)));
    ok(!r.rows.some(x=>/^pro$|upgrade to pro/i.test(x.label)),
       'pro: no Pro row — nothing left to upgrade to', JSON.stringify(r.rows.map(x=>x.label)));
    ok(r.rows.some(x=>/^account$/i.test(x.label)),'pro: the footer pair survives');
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
