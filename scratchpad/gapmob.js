process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+String(x).slice(0,200):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='gm'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('G',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const vp of [{w:390,h:844,label:'phone 390',phone:true},{w:768,h:1024,label:'tablet 768',phone:true},{w:1024,h:800,label:'small desktop 1024',phone:false},{w:1440,h:900,label:'desktop 1440',phone:false},{w:1920,h:1080,label:'wide 1920',phone:false}]) {
    const p=await b.newPage({viewport:{width:vp.w,height:vp.h},hasTouch:vp.phone,isMobile:vp.phone});
    p.on('pageerror',e=>errs.push(vp.label+': '+String(e).slice(0,120)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5000);
    const r=await p.evaluate(()=>{
      const s=document.getElementById('tbTabTouch'), c=getComputedStyle(s);
      const tb=document.querySelector('.topbar'), feed=document.getElementById('acFeed');
      const tr=tb?tb.getBoundingClientRect():null, fr=feed?feed.getBoundingClientRect():null;
      return {pos:c.position, disp:c.display, tbBot:tr?+tr.bottom.toFixed(1):null, feedTop:fr?+fr.top.toFixed(1):null,
        firstTop: feed&&feed.firstElementChild?+feed.firstElementChild.getBoundingClientRect().top.toFixed(1):null};
    });
    const gap = (r.feedTop!=null&&r.tbBot!=null)?+(r.feedTop-r.tbBot).toFixed(1):null;
    console.log('\n'+vp.label+' -> '+JSON.stringify(r)+'  gap='+gap);
    // On phones the feed deliberately rides ABOVE the menu and covers it (gap is negative).
    // The bug was the opposite: content starting BELOW the bar's bottom edge. So: never positive.
    ok(gap<=1,'['+vp.label+'] the feed is never pushed down below the tab row','gap='+gap);
    ok(r.pos==='fixed','['+vp.label+'] touch strip is out of flow (position:fixed)',r.pos);
    if(vp.phone) ok(r.disp==='block','['+vp.label+'] touch strip is still ON for phones/tablets',r.disp);
    else ok(r.disp==='none','['+vp.label+'] touch strip is OFF on desktop',r.disp);
    await p.screenshot({path:SP+'gap/'+vp.label.replace(/ /g,'-')+'.png'});
    await p.close();
  }
  ok(errs.length===0,'no JS errors on any width',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
