/* Focusing a search field must not draw a blue rectangle inside its pill. Judged on
   REAL PIXELS with the field focused: no pixel anywhere in the bar may be the accent
   blue. Covers the Settings bar (what the founder reported), the leaf-sheet input that
   shared the same rule, and the Account bar, in both themes. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto'), fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
/* How many pixels in this box look like the brand blue (#0088FF = 0,136,255)? */
function bluePixels(file) {
  const png=PNG.sync.read(fs.readFileSync(file)); let n=0, worst=null;
  for (let i=0;i<png.data.length;i+=4) {
    const r=png.data[i], g=png.data[i+1], b=png.data[i+2];
    if (b > 150 && b - r > 90 && b - g > 45) { n++; if(!worst) worst=[r,g,b]; }
  }
  return {n, worst};
}
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='fr'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('R',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  for (const theme of ['black','light']) {
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([t,th])=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[token,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5200);

    const shoot = async (sel, inputId, label, file) => {
      const box = await p.evaluate(async([sel,id])=>{
        const bar=document.querySelector(sel); if(!bar) return null;
        const inp=document.getElementById(id); if(!inp) return null;
        inp.focus(); await new Promise(r=>setTimeout(r,300));
        const q=bar.getBoundingClientRect();
        return {x:Math.round(q.left)-3,y:Math.round(q.top)-3,width:Math.round(q.width)+6,height:Math.round(q.height)+6,
                focused: document.activeElement === inp};
      },[sel,inputId]);
      ok(!!box, theme+': '+label+' is on screen to test (else this proves nothing)');
      if (!box) return;
      ok(box.focused, theme+': and the field really has focus');
      await p.screenshot({path:file, clip:{x:box.x,y:box.y,width:box.width,height:box.height}});
      const r = bluePixels(file);
      ok(r.n === 0, theme+': '+label+' draws no blue ring while focused',
         r.n+' blue pixels, e.g. rgb('+(r.worst||[]).join(',')+')');
    };

    await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1500);
    await shoot('.me-search','acMeSearch','the Account search bar', SP+'icons/FR-me-'+theme+'.png');
    await p.evaluate(()=>{ document.activeElement.blur(); openSettings(); }); await p.waitForTimeout(1300);
    await shoot('.iset-search','setSearch','the Settings search bar', SP+'icons/FR-set-'+theme+'.png');

    // and the pill still SHOWS focus, just not with an outline
    const lift = await p.evaluate(async()=>{
      const bar=document.querySelector('.iset-search'), inp=document.getElementById('setSearch');
      inp.blur(); await new Promise(r=>setTimeout(r,220));
      const off=getComputedStyle(bar).backgroundColor;
      inp.focus(); await new Promise(r=>setTimeout(r,220));
      return {off, on:getComputedStyle(bar).backgroundColor};
    });
    ok(lift.on !== lift.off, theme+': focusing still shows — the pill’s own fill lifts',
       'unfocused '+lift.off+', focused '+lift.on);
    await p.close();
  }
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
