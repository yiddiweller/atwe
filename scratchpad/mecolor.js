/* Every card on the Account page must be the SAME material. Measured in REAL PIXELS,
   not computed style: the status card once rendered at 11,11,13 against the others'
   20,20,22 — a different variable (--s1 vs --s2) that read as a different colour. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto'), fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
const dist=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='cl'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin) VALUES ('C',$1,$2,$3,true,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  for (const theme of ['black','light']) {
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([t,th])=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[token,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5200);
    await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1600);
    const f=SP+'icons/ACC-color-'+theme+'.png';
    // sample a clear patch of fill on each block: right edge, vertically centred
    /* Sample ONE block at a time, scrolling it into view first — a block below the
       fold has no pixel in a viewport screenshot, which silently reads as "no colour"
       rather than as a failure. */
    const shot=async(sels)=>{
      const out={};
      for (const [k,sel,n] of sels) {
        const pt = await p.evaluate(async([sel,n])=>{
          const es=document.querySelectorAll(sel), e=es[n||0]; if(!e) return null;
          e.scrollIntoView({block:'center'});
          await new Promise(r=>setTimeout(r,260));
          const r=e.getBoundingClientRect();
          if (r.top < 0 || r.bottom > innerHeight) return null;   // still not fully visible
          return {x:Math.round(r.left+r.width-14), y:Math.round(r.top+r.height/2)};
        }, [sel,n]);
        if (!pt) { out[k]=null; continue; }
        await p.screenshot({path:f});
        const png=PNG.sync.read(fs.readFileSync(f));
        const i=(png.width*(pt.y*2)+(pt.x*2))<<2;
        out[k]=[png.data[i],png.data[i+1],png.data[i+2]];
      }
      return out;
    };
    const hub = await shot([['hero','.me-hero'],['search','.me-search'],['sections','.me-sec',0],
                            ['tail','.me-group',1],['foot','.me-group',2]]);
    await p.evaluate(()=>acMeSection('profile')); await p.waitForTimeout(700);
    const sec = await shot([['status','.me-status'],['rows','.me-group',0]]);
    const all = Object.assign({}, hub, sec);
    console.log('  '+theme+': '+JSON.stringify(all));
    const missing = Object.keys(all).filter(k=>!all[k]);
    ok(missing.length===0, theme+': every block was found and sampled', 'missing: '+missing.join(', '));
    if (!missing.length) {
      const ref = all.sections;
      Object.keys(all).forEach((k)=>{
        if (k==='sections') return;
        ok(dist(all[k], ref) <= 3, theme+': the '+k+' block is the same colour as the option rows',
           all[k].join(',')+' vs '+ref.join(','));
      });
    }
    await p.close();
  }
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
