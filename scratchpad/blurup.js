/* A photo shows a blurry version of ITSELF immediately, then sharpens — not a grey box.
   Posts a real picture through the real composer path, then reads what the feed renders. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,280):''));}};
// a big, strongly-coloured photo so the stand-in is unmistakably the same picture
function photo(){const w=900,h=600,png=new PNG({width:w,height:h});
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(w*y+x)<<2;
    const left = x < w/2;
    png.data[i]=left?230:20; png.data[i+1]=left?40:180; png.data[i+2]=left?30:220; png.data[i+3]=255;}
  return 'data:image/png;base64,'+PNG.sync.write(png).toString('base64');}
(async()=>{
  const PHOTO=photo();
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='bu'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('B',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6000);

  // 1. the generator itself
  const lq = await p.evaluate(async(src)=>await makeLqipAsync(src), PHOTO);
  ok(!!lq && lq.startsWith('data:image/jpeg'), 'the composer can make a stand-in', String(lq).slice(0,30));
  ok(lq && lq.length < 3000, 'and it is tiny — a few hundred bytes, not a second copy', (lq?lq.length:0)+' chars vs the '+PHOTO.length+' of the photo');

  // 2. post it the way the app does, and check the server kept it
  const created = await p.evaluate(async([src,lqip])=>{
    return await API.req('POST','/api/social/posts',{body:'Blur-up probe',images:[src],lqip,toMain:true});
  },[PHOTO,lq]);
  const pid = (created && (created.post ? created.post.id : created.id));
  ok(!!pid, 'the post was created', JSON.stringify(created).slice(0,120));
  const {rows:dbr}=await pool.query('SELECT image_lqip FROM posts WHERE id=$1',[pid]);
  ok(!!(dbr[0]&&dbr[0].image_lqip), 'the server stored the stand-in');

  // 3. it comes back on the post, and renders as the image's own background
  const shown = await p.evaluate(async(id)=>{
    const d = await API.req('GET','/api/social/posts/'+id);
    const post = d.post || d;
    const html = acPostMedia(post, true);
    const box = document.createElement('div'); box.innerHTML = html; document.body.appendChild(box);
    const img = box.querySelector('img');
    const bg = img ? getComputedStyle(img).backgroundImage : '';
    const out = {lqipOnPost: !!post.lqip, bgIsData: /url\("data:image/.test(bg), bgLen: bg.length,
      // it must NOT be a CSS blur filter — a per-post blur is what crashed iOS
      filter: img?getComputedStyle(img).filter:'', bgSize: img?getComputedStyle(img).backgroundSize:''};
    box.remove(); return out;
  }, pid);
  ok(shown.lqipOnPost, 'the post carries the stand-in back to the app');
  ok(shown.bgIsData, 'and the photo paints it as its own background', 'background-image length '+shown.bgLen);
  ok(shown.bgSize==='cover', 'covering the box, so it is the same picture in the same place', shown.bgSize);
  ok(shown.filter==='none', 'with NO css blur filter (that is what used to crash iOS)', shown.filter);

  // 4. what a viewer actually sees before the photo arrives: hold the image request
  const p2=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  await p2.route('**/api/media/**', async r=>{ await new Promise(x=>setTimeout(x,4000)); r.abort(); });
  await p2.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p2.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p2.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p2.waitForTimeout(6000);
  await p2.evaluate(()=>acSetFeed('following')); await p2.waitForTimeout(2500);
  const seen = await p2.evaluate(()=>{
    const img=document.querySelector('#acFeed .ac-post-img');
    if(!img) return {none:true};
    const bb=img.getBoundingClientRect();
    return {none:false, w:Math.round(bb.width), h:Math.round(bb.height), loaded:img.complete&&img.naturalWidth>0,
      bg:/url\("data:image/.test(getComputedStyle(img).backgroundImage)};
  });
  ok(!seen.none && seen.bg && !seen.loaded,
     'with the real file still in flight, the box already shows the picture', JSON.stringify(seen));
  await p2.screenshot({path:SP+'icons/BLUR-waiting.png', clip:{x:0,y:100,width:390,height:420}});
  await p2.close();

  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
