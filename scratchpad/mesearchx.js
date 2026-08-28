/* type="search" makes WebKit paint its OWN clear button inside the field. We ship a
   custom one, so on iOS that is TWO x's side by side — it really did render that way.
   getComputedStyle on ::-webkit-search-cancel-button lies in Chromium (it reports
   display:block even when the rule hides it), so this counts INK in the picture:
   how many separate blobs sit in the right-hand end of the bar. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const fs=require('fs');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
/* Columns of the crop that contain any pixel far from the bar's own fill, grouped
   into blobs separated by a clear gap. One blob = one button. */
function blobs(file, thresh, gap) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const bg = [png.data[0], png.data[1], png.data[2]];   // top-left = the bar's fill
  const cols = [];
  for (let x = 0; x < png.width; x++) {
    let ink = 0;
    for (let y = 0; y < png.height; y++) {
      const i = (png.width * y + x) << 2;
      const d = Math.abs(png.data[i]-bg[0]) + Math.abs(png.data[i+1]-bg[1]) + Math.abs(png.data[i+2]-bg[2]);
      if (d > thresh) ink++;
    }
    cols.push(ink > 0);
  }
  const out = []; let run = null;
  cols.forEach((on, x) => {
    if (on) { if (!run) run = {a:x,b:x}; else run.b = x; }
    else if (run && x - run.b > gap) { out.push(run); run = null; }
  });
  if (run) out.push(run);
  return { blobs: out, width: png.width };
}
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='xx'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('X',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  for (const theme of ['black','light']) {
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([t,th])=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[token,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5200);
    await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1500);
    await p.evaluate(()=>{const i=document.getElementById('acMeSearch');i.value='order';i.dispatchEvent(new Event('input'));i.focus();});
    await p.waitForTimeout(400);
    // Crop the right-hand quarter of the bar, where any clear button must live.
    const box = await p.evaluate(()=>{const r=document.querySelector('.me-search').getBoundingClientRect();
      return {x:Math.round(r.left+r.width*0.72),y:Math.round(r.top),width:Math.round(r.width*0.28),height:Math.round(r.height)};});
    const f = SP+'icons/ACC-searchx-'+theme+'.png';
    await p.screenshot({path:f, clip:box});
    const r = blobs(f, 40, 6);
    console.log('  '+theme+': '+JSON.stringify(r.blobs)+' (crop '+r.width+'px)');
    ok(r.blobs.length===1, theme+' theme: exactly ONE clear button in the field, not the native one as well',
       'found '+r.blobs.length+' separate blobs');
    await p.close();
  }
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
