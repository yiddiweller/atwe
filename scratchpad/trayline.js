/* No hairline between the Dailies and the posts — in the real feed OR while loading.
   Scans real pixels in the left gutter, the same way the owner's screenshot showed it:
   a hairline is a row brighter than BOTH its neighbours. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto'), fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,280):''));}};
const PHOTO='data:image/png;base64,'+Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAADZbCibAAAAG0lEQVQI12P8//8/AzbAxIAD0EFi'+'FDGMKjmMSgIAcMYD/Zn6+ZQAAAAASUVORK5CYII=','base64').toString('base64');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const theme of ['black','light']) {
    const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
    const h='tl'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('T',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
    const uid=rows[0].id;
    const t=auth.signToken({id:uid,email,is_admin:false});
    await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
    await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at) VALUES ($1,'Tray line probe',$2,600,400,true,now())`,[uid,PHOTO]);
    // a story, so the real tray actually renders
    await pool.query(`INSERT INTO stories (user_id,kind,media,expires_at) VALUES ($1,'text','',now()+interval '20 hours')`,[uid]).catch(()=>{});
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(6000);
    console.log('\n── '+theme+' ──');

    const scan=async(label)=>{
      const geo=await p.evaluate(()=>{
        const tray=document.querySelector('#acFeed .ac-home-stories, #acFeed .skel-stories');
        if(!tray) return null;
        const bb=tray.getBoundingClientRect();
        return {bottom:bb.bottom, left:bb.left, style:getComputedStyle(tray).borderBottomWidth};
      });
      if(!geo){ ok(false, label+' — the tray is on screen to test'); return; }
      ok(geo.style==='0px', label+' — the tray declares no bottom border', 'border-bottom-width '+geo.style);
      const f=SP+'icons/TRAY-'+theme+'-'+label.replace(/\W+/g,'')+'.png';
      await p.screenshot({path:f});
      const im=PNG.sync.read(fs.readFileSync(f));
      const rowAvg=(y)=>{let s=0,n=0; for(let x=6;x<70;x++){const i=((im.width*y+x)<<2); s+=im.data[i]; n++;} return s/n;};
      /* Look in a band around the tray's bottom edge, in the LEFT GUTTER — outside the
         post card, so the card's own edge cannot be mistaken for a divider. */
      const y0=Math.round(geo.bottom*2);
      let worst=null;
      for(let y=y0-14; y<=y0+14; y++){
        const a=rowAvg(y-2), c0=rowAvg(y), c=rowAvg(y+2);
        const light = theme==='light';
        const d = light ? Math.min(a-c0, c-c0) : Math.min(c0-a, c0-c);   // dark line on white, light line on black
        if(d>1.5 && (!worst || d>worst.d)) worst={y, d:+d.toFixed(1), val:+c0.toFixed(1)};
      }
      ok(!worst, label+' — and no hairline is painted between the Dailies and the posts',
         worst ? 'a line at y='+worst.y+' stands '+worst.d+' off its neighbours' : '');
    };

    // 1) the LOADING tray
    await p.route('**/api/social/feed**', async r=>{ await new Promise(x=>setTimeout(x,20000)); r.abort(); });
    await p.evaluate(()=>acSetFeed('following'));
    await p.waitForTimeout(1200);
    await scan('loading');
    // 2) the REAL tray
    await p.unroute('**/api/social/feed**');
    await p.evaluate(()=>acSetFeed('foryou'));
    await p.waitForTimeout(3500);
    await scan('real feed');
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
