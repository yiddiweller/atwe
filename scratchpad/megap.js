/* Measure every vertical gap down the Account hub. The founder sees the search bar
   sitting tighter to the wallet than to the cards below it. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='gp'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin) VALUES ('G',$1,$2,$3,true,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1600);
  const g = await p.evaluate(()=>{
    const body=document.getElementById('acMeBody');
    const kids=[...body.children].filter(e=>e.offsetHeight>0);
    const out=[];
    for (let i=0;i<kids.length-1;i++){
      const a=kids[i].getBoundingClientRect(), b=kids[i+1].getBoundingClientRect();
      out.push({ from:kids[i].className.split(' ')[0]||kids[i].id, to:kids[i+1].className.split(' ')[0]||kids[i+1].id,
                 gap:Math.round(b.top-a.bottom) });
    }
    // #acMeList wraps the cards, so also measure inside it
    const list=document.getElementById('acMeList');
    if (list) { const gs=[...list.children].filter(e=>e.offsetHeight>0);
      for (let i=0;i<gs.length-1;i++){ const a=gs[i].getBoundingClientRect(), b=gs[i+1].getBoundingClientRect();
        out.push({ from:'group'+i, to:'group'+(i+1), gap:Math.round(b.top-a.bottom) }); }
      const s=document.querySelector('.me-search');
      if (s&&gs[0]) out.push({from:'search', to:'firstCard', gap:Math.round(gs[0].getBoundingClientRect().top - s.getBoundingClientRect().bottom)});
    }
    return out;
  });
  g.forEach(x=>console.log('  '+x.from+' -> '+x.to+' : '+x.gap+'px'));
  const above = g.find(x=>x.to==='me-search'||x.to==='acMeList');
  const below = g.find(x=>x.from==='search');
  ok(above&&below&&above.gap===below.gap,
     'the space above the search bar equals the space below it',
     'above '+(above?above.gap:'?')+'px, below '+(below?below.gap:'?')+'px');
  const cardGaps = g.filter(x=>/^group/.test(x.from)).map(x=>x.gap);
  ok(cardGaps.length>0 && new Set(cardGaps.concat(below?[below.gap]:[])).size===1,
     'and it matches the gaps between the cards', JSON.stringify(cardGaps));
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
