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
  const h='ad'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('A',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const theme of ['black','light']) {
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(theme+': '+String(e).slice(0,120)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(({t,th})=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},{t:token,th:theme});
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5200);
    for (const [world,addId,tabId] of [['home','acFeedTabAdd','acFeedTab-following'],['chat','acChatTabAdd','acseg-groups']]) {
      await p.evaluate(w=>appTab(w),world); await p.waitForTimeout(1800);
      const r=await p.evaluate(({a,t})=>{
        const A=document.getElementById(a), T=document.getElementById(t);
        const ca=getComputedStyle(A), ct=getComputedStyle(T);
        const ra=A.getBoundingClientRect(), rt=T.getBoundingClientRect();
        const row=A.parentElement.getBoundingClientRect();
        return {text:A.textContent.trim(), svg:A.querySelectorAll('svg').length,
          sizeA:ca.fontSize, sizeT:ct.fontSize, wA:ca.fontWeight, wT:ct.fontWeight,
          colA:ca.color, colT:ct.color, aria:A.getAttribute('aria-label'),
          hA:+ra.height.toFixed(1), hT:+rt.height.toFixed(1),
          sameLine: Math.abs((ra.top+ra.height/2)-(rt.top+rt.height/2))<2,
          lastInRow: A.parentElement.lastElementChild===A,
          rightEdge:+(row.right-ra.right).toFixed(1)};
      },{a:addId,t:tabId});
      const lum=c=>{const m=c.match(/\d+/g).map(Number); return 0.2126*m[0]+0.7152*m[1]+0.0722*m[2];};
      const quieter = theme==='light' ? lum(r.colA)>lum(r.colT) : lum(r.colA)<lum(r.colT);
      ok(r.text==='Add','['+theme+'/'+world+'] the trailing control reads "Add"',r.text);
      ok(r.svg===0,'['+theme+'/'+world+'] the + icon is gone','svgs='+r.svg);
      ok(r.sizeA===r.sizeT,'['+theme+'/'+world+'] same font size as a tab label',r.sizeA+' vs '+r.sizeT);
      ok(r.wA===r.wT,'['+theme+'/'+world+'] same weight as an inactive tab',r.wA+' vs '+r.wT);
      ok(quieter,'['+theme+'/'+world+'] quieter than an inactive tab',r.colA+' vs '+r.colT);
      ok(r.sameLine,'['+theme+'/'+world+'] sits on the same baseline as the tabs');
      ok(r.lastInRow,'['+theme+'/'+world+'] still the last thing in the row');
      ok(!!r.aria,'['+theme+'/'+world+'] keeps an accessible name',r.aria);
      // scroll the tab row to its end so the trailing "Add" is actually in frame
      await p.evaluate(a=>{const r=document.getElementById(a).parentElement; r.scrollLeft=r.scrollWidth;},addId);
      await p.waitForTimeout(500);
      await p.screenshot({path:SP+'icons/ADD-'+theme+'-'+world+'.png',clip:{x:0,y:0,width:390,height:130}});
    }
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
