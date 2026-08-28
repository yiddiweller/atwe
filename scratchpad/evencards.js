/* ONE corner for every card in the app (owner: "I want it to be like even everywhere").
   A card here is a wide block (>=200px) that actually PAINTS a fill and turns a real
   corner — the things seen side by side and above the nav bar. The audit that prompted
   this found FOUR different corners on screen at once: post cards and the bar at 30, the
   settings-shaped cards at 26, and two heroes at 20, three of them stacked on the Account
   page. Every one of them must now be --post-card-r.
   Excluded on purpose: capsules (their radius is their own height), the desktop sidebar
   and right rail (nav, off-canvas on a phone), and anything with no painted fill — an
   invisible radius cannot look uneven. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
const PROBE=`(()=>{
  const eff=(e,ps)=>{const bb=e.getBoundingClientRect(),cs=getComputedStyle(e,ps||null);
    const parts=cs.borderRadius.split('/')[0].trim().split(/\\s+/);
    const vals=parts.map(d=>d.endsWith('%')?(parseFloat(d)/100)*Math.min(bb.width,bb.height):parseFloat(d)).filter(x=>!isNaN(x));
    return +Math.min(Math.max(...vals,0), bb.height/2, bb.width/2).toFixed(1);};
  const seen={};
  document.querySelectorAll('*').forEach(e=>{
    const bb=e.getBoundingClientRect();
    if(bb.width<200||bb.height<28) return;
    if(bb.bottom<0||bb.top>innerHeight) return;
    if(e.closest('.sidebar,.right-rail,#sidebar,#rightRail')) return;
    const cs0=getComputedStyle(e); const bg=cs0.backgroundColor;
    const painted = (bg && bg!=='rgba(0, 0, 0, 0)' && bg!=='transparent') || cs0.backgroundImage!=='none';
    let r=eff(e); let via='';
    if(!r){ const pr=eff(e,'::before'); const pb=getComputedStyle(e,'::before');
      if(pr&&pb.content!=='none'){ r=pr; via=' (card drawn as ::before)'; } }
    else if(!painted) return;
    if(!r) return;
    if(Math.abs(r-Math.min(bb.width,bb.height)/2)<0.6) return;   // a capsule, not a card
    const k=(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).slice(0,2).join('.'):e.tagName.toLowerCase())+via;
    if(!seen[k]) seen[k]={r,w:Math.round(bb.width),h:Math.round(bb.height),n:0};
    seen[k].n++;});
  return seen;})()`;
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='cs'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,balance_cents) VALUES ('Yiddi Weller',$1,$2,$3,true,true,17813) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id; const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  for(let i=0;i<5;i++) await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,$2,true,now()-($3||' seconds')::interval)`,[uid,'Sweep post '+i,i]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(7000);
  const go=[
    ['Home feed', ()=>acSetFeed('following'), true],
    ['Account page', ()=>appTab('profile'), true],
    ['Settings', ()=>openSettings(), true],
    ['Wallet', ()=>{closeOverlay('settingsOverlay');acOpenWallet();}, true],
    ['Engine', ()=>{closeOverlay('walletView');appTab('search');}, true],
    ['Beam', ()=>appTab('chat'), false],
    ['Notifications', ()=>acNavNotifs(), false],
  ];
  let pass=0,fail=0;
  const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
  const want=await p.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--post-card-r')));
  console.log('every card must turn on '+want+'\n');
  for(const [name,fn,mustHaveCards] of go){
    try{ await p.evaluate(fn); }catch(e){ ok(false,name+' opens',String(e).slice(0,80)); continue; }
    await p.waitForTimeout(2400);
    const r=await p.evaluate(PROBE);
    const list=Object.entries(r).sort((a,b)=>b[1].r-a[1].r);
    list.forEach(([k,v])=>console.log('     '+String(v.r).padStart(6)+'   '+String(v.w+'x'+v.h).padEnd(10)+' x'+String(v.n).padEnd(3)+' '+k.slice(0,58)));
    const odd=list.filter(([k,v])=>Math.abs(v.r-want)>0.6);
    if(mustHaveCards) ok(list.length>0, name+': a card is on screen to test', list.length+' found');
    else console.log('     (a full-bleed row surface \u2014 no wide cards here, swept for strays anyway)');
    ok(odd.length===0, name+': every card turns on the same corner',
       odd.map(([k,v])=>k+' = '+v.r).join(' | '));
  }
  await b.close(); await pool.end();
  console.log('\n\u2550\u2550\u2550 '+pass+' passed, '+fail+' failed \u2550\u2550\u2550');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
