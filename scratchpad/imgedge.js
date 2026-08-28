/* A pure-BLACK photo on the black app, and a pure-WHITE photo on the light app, must
   still show their own edge. Proven by scanning REAL PIXELS across the middle of the
   photo: the hairline is a row of pixels that differ from BOTH the photo and the page.
   Seeded with a genuinely black 1x1 PNG so this is the founder's exact case. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto'), fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
const near=(a,b,t)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2])<=t;
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
/* A solid PNG of one colour, as a data URL. The SHAPE matters: a square photo
   letterboxes inside these boxes against --s2, and that band is not the border —
   an earlier version of this probe measured the band and passed with the border
   removed. 16:10 fills a feed card exactly; 4:3 fills a chat bubble exactly. */
function solid(r,g,bl,w,h){
  w=w||32; h=h||20;
  const png=new PNG({width:w,height:h});
  for(let i=0;i<w*h;i++){const o=i<<2;png.data[o]=r;png.data[o+1]=g;png.data[o+2]=bl;png.data[o+3]=255;}
  return 'data:image/png;base64,'+PNG.sync.write(png).toString('base64');
}
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='ie'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('E',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const token=auth.signToken({id:uid,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),uid]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});

  /* Compare the element's OWN first pixel column against a column just inside it.
     A first attempt scanned for "any pixel unlike the page or the photo" and passed
     even with the border removed — because these photos letterbox against --s2, and
     that band is unlike both. The hairline is specifically the element's outermost
     pixels differing from what sits immediately inside them. */
  const edgeAt = (file, box, ownBg) => {
    const png=PNG.sync.read(fs.readFileSync(file));
    const y = Math.round((box.y + box.height/2) * 2);
    const at = (dx) => { const x = Math.round(box.x*2) + dx; const i=(png.width*y+x)<<2;
      return [png.data[i],png.data[i+1],png.data[i+2]]; };
    const edge = at(1);      // inside the 2-device-px border, past the outer AA row
    const inside = at(10);   // safely past it
    /* The hairline must differ from the element's OWN background, not merely from the
       photo. A transparent border still shows that background as a 1px band at the
       edge, so "differs from the photo" passes with the border switched off — two
       earlier versions of this check did exactly that. */
    const d = Math.abs(edge[0]-ownBg[0])+Math.abs(edge[1]-ownBg[1])+Math.abs(edge[2]-ownBg[2]);
    return {edge, inside, ownBg, d, ok: d >= 12};
  };

  for (const theme of ['black','light']) {
    const shade = theme==='black' ? [0,0,0] : [255,255,255];
    const feedImg = solid(shade[0],shade[1],shade[2],32,20);   // 16:10, fills a feed card
    const chatImg = solid(shade[0],shade[1],shade[2],32,24);   // 4:3, fills a chat bubble
    const pr = await pool.query(`INSERT INTO posts (user_id,body,image,to_main) VALUES ($1,'',$2,true) RETURNING id`,[uid,feedImg]);
    await pool.query(`INSERT INTO at_messages (sender_id,recipient_id,body,image) VALUES ($1,$1,'',$2)`,[uid,chatImg]);
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([t,th])=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[token,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5200);

    // --- home feed --------------------------------------------------------
    /* Following (not For You): it serves your own posts chronologically, so the
       seeded photo is reliably on screen. Same home feed, same acPostCard renderer,
       same CSS — For You is engagement-ranked and buried it. */
    await p.evaluate(()=>{ appTab('home'); acSetFeed('following'); }); await p.waitForTimeout(3000);
    let box = await p.evaluate(()=>{ const i=document.querySelector('#acFeed .ac-post-img');
      if(!i) return null; i.scrollIntoView({block:'center'});
      return new Promise(r=>setTimeout(()=>{const q=i.getBoundingClientRect();
        const bg=(getComputedStyle(i).backgroundColor.match(/\d+/g)||[0,0,0]).slice(0,3).map(Number);
        r({x:q.left,y:q.top,width:q.width,height:q.height,bg});},400)); });
    ok(!!box, theme+': a photo post is on screen to test (else this proves nothing)');
    if (box) {
      const f=SP+'icons/EDGE-feed-'+theme+'.png';
      await p.screenshot({path:f});
      const e=edgeAt(f, box, box.bg);
      ok(near(e.inside, shade, 14), theme+': the feed photo fills its box (no letterbox to mistake for an edge)',
         'inside is '+e.inside.join(',')+', the photo is '+shade.join(','));
      /* A POST photo no longer draws a hairline (owner): the card behind it is the edge
         now, so the outline was doing the job twice. Absence is asserted from the
         COMPUTED STYLE, not from pixels — scanning can prove a border is THERE (that is
         why this probe exists) but cannot prove one is absent: a border the same colour
         as what is behind it looks identical to none at all, and near a 14px rounded
         corner the sample can land on the card instead of the photo. */
      const bw = await p.evaluate(()=>{const i=document.querySelector('#acFeed .ac-post-img');
        return i?getComputedStyle(i).borderTopWidth:null;});
      ok(bw==='0px', theme+': the feed photo has NO hairline (the card is its edge now)',
         'border-top-width is '+bw);
      console.log('       edge '+e.edge.join(',')+' vs its own bg '+e.ownBg.join(',')+' (\u0394'+e.d+') | photo '+e.inside.join(','));
    }

    // --- Beam chat --------------------------------------------------------
    await p.evaluate((id)=>acOpenChat(id), uid); await p.waitForTimeout(2600);
    let mbox = await p.evaluate(()=>{ const i=document.querySelector('.msg-photo');
      if(!i) return null; i.scrollIntoView({block:'center'});
      return new Promise(r=>setTimeout(()=>{const q=i.getBoundingClientRect();
        const bg=(getComputedStyle(i).backgroundColor.match(/\d+/g)||[0,0,0]).slice(0,3).map(Number);
        r({x:q.left,y:q.top,width:q.width,height:q.height,bg});},400)); });
    ok(!!mbox, theme+': a chat photo is on screen to test');
    if (mbox) {
      const f=SP+'icons/EDGE-chat-'+theme+'.png';
      await p.screenshot({path:f});
      const e=edgeAt(f, mbox, mbox.bg);
      ok(near(e.inside, shade, 14), theme+': the chat photo fills its box (no letterbox to mistake for an edge)',
         'inside is '+e.inside.join(',')+', the photo is '+shade.join(','));
      ok(e.ok, theme+': the chat photo draws its own hairline edge',
         'the edge is just the element background ('+e.ownBg.join(',')+') \u2014 no hairline painted');
      console.log('       edge '+e.edge.join(',')+' vs its own bg '+e.ownBg.join(',')+' (\u0394'+e.d+') | photo '+e.inside.join(','));
    }
    await p.close();
    await pool.query('DELETE FROM posts WHERE id=$1',[pr.rows[0].id]);
    await pool.query('DELETE FROM at_messages WHERE sender_id=$1',[uid]);
  }
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
