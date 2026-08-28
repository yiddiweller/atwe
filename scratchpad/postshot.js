/* Postshot renders the SAME card as the app — with its own bits kept: the Atwe mark
   top-right and the full date beside it. Renders a real one and reads its pixels. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto'), fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,260):''));}};
// a real 240x160 photo so the image box is filled, not letterboxed
function photo(){const w=240,h=160,png=new PNG({width:w,height:h});
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(w*y+x)<<2;
    png.data[i]=40+((x*200/w)|0); png.data[i+1]=90; png.data[i+2]=200-((y*120/h)|0); png.data[i+3]=255;}
  return 'data:image/png;base64,'+PNG.sync.write(png).toString('base64');}
(async()=>{
  const PHOTO=photo();
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='ps'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,verified) VALUES ('Postshot Probe',$1,$2,$3,true,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const t=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),uid]);
  const {rows:pr}=await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at)
    VALUES ($1,'Stop boosting posts. Start telling stories.',$2,240,160,true,now()) RETURNING id`,[uid,PHOTO]);
  await pool.query(`INSERT INTO post_likes (post_id,user_id) SELECT $1,id FROM users WHERE id <> $2 ORDER BY id LIMIT 120 ON CONFLICT DO NOTHING`,[pr[0].id,uid]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const theme of ['black','light']) {
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(6000);
    console.log('\n── '+theme+' ──');
    const dataUrl=await p.evaluate(async(id)=>{
      const post=await API.req('GET','/api/social/posts/'+id);
      const blob=await _renderPostshot(post.post||post);
      return await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(blob);});
    }, pr[0].id);
    ok(!!dataUrl && dataUrl.startsWith('data:image/png'), 'a Postshot rendered', String(dataUrl).slice(0,40));
    const file=SP+'icons/PSHOT-'+theme+'.png';
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1],'base64'));
    const im=PNG.sync.read(fs.readFileSync(file));
    const px=(x,y)=>{const i=((im.width*y+x)<<2);return [im.data[i],im.data[i+1],im.data[i+2]];};
    const same=(a,bb,tol=6)=>a.every((v,i)=>Math.abs(v-bb[i])<=tol);
    console.log('     image '+im.width+'x'+im.height);
    // SC=2, so canvas units double: gutter 26 -> 52 device px
    const pageC=px(6,6), cardC=px(im.width/2, 60);
    ok(!same(pageC,cardC), 'the card sits on a page margin, not edge to edge', 'page '+pageC+'  card '+cardC);
    /* ASK THE APP what its card colour is rather than hardcoding a hex here — this
       expectation was written against #1C1C1E and went stale the moment the card moved
       to --s2, which is exactly the drift the assertion is supposed to catch. */
    const want = (await p.evaluate(()=>{const d=document.createElement('div');
      d.style.cssText='position:absolute;left:-9999px;background:var(--s2)';
      document.body.appendChild(d); const c=getComputedStyle(d).backgroundColor; d.remove();
      return c;})).match(/\d+/g).slice(0,3).map(Number);
    ok(same(cardC,want,4), 'and its fill is the app’s own card colour', 'got '+cardC+' want '+want);
    /* SCAN for the pill colour in the bottom third of the card rather than computing a
       row: the card's height depends on the body and the photo, so an exact y was a
       guess — and it landed off the card entirely, reporting the page colour. */
    const wantPill = (await p.evaluate(()=>{const d=document.createElement('div');
      d.style.cssText='position:absolute;left:-9999px;background:var(--post-pill)';
      document.body.appendChild(d); const c=getComputedStyle(d).backgroundColor; d.remove();
      return c;})).match(/\d+/g).slice(0,3).map(Number);
    let hits=0, rowY=null;
    for (let y=Math.floor(im.height*0.72); y<im.height-40 && !rowY; y+=2){
      let n=0; for (let x=60;x<im.width-60;x+=3) if(same(px(x,y),wantPill,6)) n++;
      if (n>40){ rowY=y; hits=n; }
    }
    ok(rowY!==null, 'the actions are pills in the app’s pill colour', 'no row of '+wantPill+' found in the lower card');
    if (rowY!==null){
      /* Count the runs ACROSS THE CARD ONLY. The pill is now the page colour, so the
         page margin either side of the card matches the pill exactly and a scan that
         starts at x=40 counts each margin as a sixth and seventh "pill". Find the card's
         own left and right edges on this row first, then count between them. */
      let l=0, r=im.width-1;
      while (l<im.width && !same(px(l,rowY),want,6)) l++;
      while (r>l && !same(px(r,rowY),want,6)) r--;
      let runs=0, inRun=false;
      for (let x=l;x<=r;x++){const on=same(px(x,rowY),wantPill,6);
        if(on&&!inRun){runs++;inRun=true;} else if(!on&&inRun){inRun=false;}}
      ok(runs===5, 'five separate pills, one per action', runs+' runs across the card ('+l+'..'+r+')');
    }
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
