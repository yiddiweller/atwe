/* Every settings-shaped OPTION is one size, and a single-row card is a clean capsule.
   Two things the founder caught on a real phone:
   - the search bar was 42px against the rows' 55 (it had no min-height at all), and the
     Account rows said 52 while the Settings rows said 50, so the two pages were a hair
     apart as well;
   - a card holding ONE row is a capsule, and it was still drawing the group's top hairline
     and the row's bottom hairline — a straight line across a shape whose top IS a curve,
     which flattens both ends. That is what they circled on the Settings pill. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP=__dirname+'/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};
(async()=>{
  const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
  const u='rs'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,verified,account_type,is_admin)
    VALUES ($1,$2,$3,$4,true,true,true,'business',true) RETURNING id`,['Row Size',e,h,u]);
  const id=rows[0].id, t=auth.signToken({id,email:'x',is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for(const theme of ['black','light']){
    console.log('\n══ '+theme+' ══');
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
      localStorage.setItem('atwe_theme',th);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(6500);
    await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(2200);

    const acct=await p.evaluate(()=>{
      const H=e=>+e.getBoundingClientRect().height.toFixed(1);
      const search=document.querySelector('#acMeBody .me-search');
      const rowsAll=[...document.querySelectorAll('#acMeBody .me-group > .me-row')];
      const singles=[...document.querySelectorAll('#acMeBody .me-group')].filter(g=>g.children.length===1);
      return {
        search: search?H(search):null,
        row: rowsAll.length?H(rowsAll[0]):null,
        singles: singles.map(g=>({h:H(g), r:getComputedStyle(g).borderTopLeftRadius,
          bt:getComputedStyle(g).borderTopWidth,
          bb:getComputedStyle(g.firstElementChild).borderBottomWidth,
          label:(g.textContent||'').trim().slice(0,16)})),
      };});
    /* A card's own top and bottom edges are CURVES. A straight hairline drawn along them
       flattens both corners — the same fault as on a capsule, one step out, and the founder
       marked the bottom corners of a multi-row card after the capsules were fixed. Only the
       lines BETWEEN rows are real dividers. */
    const multi=await p.evaluate(()=>{
      const g=[...document.querySelectorAll('#acMeBody .me-group')].find(x=>x.children.length>1);
      if(!g) return null; const k=[...g.children];
      return {groupTop:getComputedStyle(g).borderTopWidth,
              first:getComputedStyle(k[0]).borderBottomWidth,
              last:getComputedStyle(k[k.length-1]).borderBottomWidth};});
    ok(multi && parseFloat(multi.groupTop)===0 && parseFloat(multi.last)===0,
       'Account: a multi-row card draws no hairline across its own top or bottom edge',
       multi?('group top '+multi.groupTop+', last row bottom '+multi.last):'no multi-row card');
    ok(multi && parseFloat(multi.first)>0,
       'Account: but the dividers BETWEEN its rows are still there',
       multi?('first row bottom '+multi.first):'');
    ok(acct.search===acct.row, 'Account: the search bar is the same height as an option row',
       'search '+acct.search+', row '+acct.row);
    ok(acct.singles.length>0, 'Account: there are single-row capsule cards', acct.singles.length+' of them');
    for(const g of acct.singles){
      ok(g.h===acct.row, '"'+g.label+'" is the same height as a row', 'card '+g.h+', row '+acct.row);
      /* the capsule's ends must be a clean curve — no hairline drawn across them */
      ok(parseFloat(g.bt)===0 && parseFloat(g.bb)===0,
         '"'+g.label+'" draws no hairline across its rounded ends',
         'group top '+g.bt+', row bottom '+g.bb);
      const eff=Math.min(parseFloat(g.r)||0, g.h/2);
      ok(Math.abs(eff-g.h/2)<0.6, '"'+g.label+'" is a true capsule', 'radius '+eff+', half its height '+(g.h/2));
    }

    await p.evaluate(()=>openSettings()); await p.waitForTimeout(1700);
    const set=await p.evaluate(()=>{
      const H=e=>+e.getBoundingClientRect().height.toFixed(1);
      const search=document.querySelector('#settingsOverlay .iset-search');
      const singles=[...document.querySelectorAll('#settingsOverlay .iset-group')]
        .filter(g=>g.children.length===1 && g.getBoundingClientRect().height>2);
      const so=document.querySelector('#settingsOverlay .iset-signout');
      const g=[...document.querySelectorAll('#settingsOverlay .iset-group')]
        .find(x=>x.children.length>1 && x.getBoundingClientRect().height>2);
      const k=g?[...g.children]:null;
      return {search:search?H(search):null, signout:so?H(so):null,
        multi:g?{groupTop:getComputedStyle(g).borderTopWidth,
                 last:getComputedStyle(k[k.length-1]).borderBottomWidth}:null,
        singles:singles.map(g=>({bt:getComputedStyle(g).borderTopWidth,
          bb:getComputedStyle(g.firstElementChild).borderBottomWidth,
          label:(g.textContent||'').trim().slice(0,14)}))};});
    ok(set.search===acct.search, 'Settings: its search bar is the SAME size as the Account one',
       'settings '+set.search+', account '+acct.search);
    ok(set.signout===acct.row, 'Settings: "Sign out" is the same size as any other single option',
       'sign out '+set.signout+', a row '+acct.row);
    ok(set.multi && parseFloat(set.multi.groupTop)===0 && parseFloat(set.multi.last)===0,
       'Settings: a multi-row card draws no hairline across its own top or bottom edge',
       set.multi?('group top '+set.multi.groupTop+', last row bottom '+set.multi.last):'none');
    for(const g of set.singles)
      ok(parseFloat(g.bt)===0 && parseFloat(g.bb)===0,
         'Settings "'+g.label+'" draws no hairline across its rounded ends',
         'group top '+g.bt+', row bottom '+g.bb);
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
