/* The action pills grew 28 -> 36 tall to stay concentric with the card. Check the row
   still fits across a phone with BIG counts, and that no pill clips its number. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:320,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='pf'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('P',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const t=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),rows[0].id]);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6500);
  // render a post with the biggest counts a real post can show, on the NARROWEST phone
  const r=await p.evaluate(()=>{
    const post={id:1, body:'Big counts', author:{id:1,name:'A',username:'a'}, created_at:new Date().toISOString(),
      likes:123456, replies:98765, reposts:45678, views:9876543, bookmarked:false, images:[], locked:false};
    const box=document.createElement('div'); box.id='pfBox';
    box.style.cssText='position:fixed;left:0;right:0;top:0;';
    box.innerHTML='<div id="acFeed">'+acPostCard(post)+'</div>';
    document.body.appendChild(box);
    const row=box.querySelector('.ac-post-actions');
    const pills=[...row.children];
    const rb=row.getBoundingClientRect();
    const out={rowW:Math.round(rb.width), rowRight:Math.round(rb.right),
      pills:pills.map(e=>{const bb=e.getBoundingClientRect();
        const n=e.querySelector('.ac-act-n');
        /* Compare the NUMBER's box with the pill's, not scrollWidth: each pill carries a
           ::before that deliberately extends 3px past it on each side to reach the 44pt
           touch target, and that overflow makes scrollWidth exceed clientWidth on every
           pill — including the empty bookmark, which cannot clip anything. */
        const nb = n ? n.getBoundingClientRect() : null;
        return {w:Math.round(bb.width), h:Math.round(bb.height), right:Math.round(bb.right),
          clipped: !!(nb && (nb.right > bb.right + 0.5 || nb.left < bb.left - 0.5)),
          txt:(n?n.textContent:'').trim()};})};
    box.remove(); return out;
  });
  console.log('   row width '+r.rowW+'  on a 320px phone');
  r.pills.forEach(x=>console.log('     pill '+String(x.w).padStart(3)+'x'+x.h+'  "'+x.txt+'"'+(x.clipped?'   CLIPPED':'')));
  ok(r.pills.every(x=>x.h===36), 'every pill is the concentric 36px tall', JSON.stringify(r.pills.map(x=>x.h)));
  ok(r.pills.every(x=>!x.clipped), 'no pill clips its own number, even with 7-digit counts',
     JSON.stringify(r.pills.filter(x=>x.clipped)));
  ok(r.pills.every(x=>x.right<=r.rowRight+1), 'and the row does not overflow the card', 'row right '+r.rowRight);
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
