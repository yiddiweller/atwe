/* Everywhere a profile picture sits BESIDE a stack of text, the text must be centred on
   the picture. The owner spotted this on a post card: the picture had just been pinned to
   the card's padding edge (so it is concentric with the corner) and the taller name+handle
   column then sat 3.7px lower. Walks real surfaces rather than a hand-written class list,
   so a new component cannot slip through.
   A row that DELIBERATELY top-aligns (a notification is a sentence, not a name stack) is
   skipped by reading its own align-items — the rule is "if you centre, actually centre". */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
const PHOTO=require(SP+'mkpng.js')(600,400,[86,104,132]);
const PROBE=`(()=>{
  const out=[];
  document.querySelectorAll('.user-avatar').forEach(av=>{
    const a=av.getBoundingClientRect(); if(a.width<18||a.height<18) return;
    if(a.bottom<0||a.top>innerHeight) return;
    // the text column is the picture's next laid-out sibling (or its wrapper's)
    let node=av, col=null;
    for(let up=0; up<3 && node; up++){
      let sib=node.nextElementSibling;
      while(sib){ const r=sib.getBoundingClientRect();
        if(r.width>30 && r.height>6 && (sib.innerText||'').trim()){ col=sib; break; }
        sib=sib.nextElementSibling; }
      if(col) break; node=node.parentElement;
    }
    if(!col) return;
    const c=col.getBoundingClientRect();
    /* only BESIDE layouts: the text starts after the picture and overlaps it vertically.
       A name UNDER a picture (the story tray, a profile header, a who-to-follow card) is
       a different arrangement and would read as a huge false "drift". */
    if(c.left < a.right - 2) return;
    if(c.height > a.height*1.6) return;
    if(c.bottom < a.top || c.top > a.bottom) return;
    const row=col.parentElement; const ai=row?getComputedStyle(row).alignItems:'';
    if(ai==='flex-start'||ai==='start'||ai==='baseline') return;
    const cls=(av.closest('[class]')&&av.parentElement?av.parentElement.className:'')||'';
    const rowCls=(col.className||'')+'';
    out.push({where:((rowCls||cls).split(/\\s+/)[0])+' <'+col.tagName.toLowerCase()+'> "'+(col.innerText||'').trim().split('\\n')[0].slice(0,20)+'"', av:+a.height.toFixed(1), col:+c.height.toFixed(1),
      drift:+((c.top+c.height/2)-(a.top+a.height/2)).toFixed(1)});
  });
  return out;})()`;
(async()=>{
  const mk=async(name,type)=>{const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
    const h=(type==='business'?'bs':'ps')+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,account_type,headline) VALUES ($1,$2,$3,$4,true,true,$5,'Some headline here') RETURNING id`,[name,email,hash,h,type]);
    return {id:rows[0].id,h};};
  const me=await mk('Saffron Kitchen Co.','personal');
  const other=await mk('Marcus Bell','personal');
  const t=auth.signToken({id:me.id,email:'x',is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(t).digest('hex'),me.id]);
  await pool.query('INSERT INTO follows (follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[me.id,other.id]);
  const {rows:pr}=await pool.query(`INSERT INTO posts (user_id,body,image,image_w,image_h,to_main,created_at) VALUES ($1,'We almost shut down last winter.',$2,600,400,true,now()) RETURNING id`,[other.id,PHOTO]);
  await pool.query(`INSERT INTO posts (user_id,body,parent_id,created_at) VALUES ($1,'A reply for the thread.',$2,now())`,[me.id,pr[0].id]);
  await pool.query(`INSERT INTO at_messages (sender_id,recipient_id,body,created_at) VALUES ($1,$2,'hello there',now())`,[other.id,me.id]);
  await pool.query(`INSERT INTO notifications (user_id,actor_id,type,post_id,created_at) VALUES ($1,$2,'like',$3,now())`,[me.id,other.id,pr[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(7000);
  const surfaces=[
    ['Home feed', async()=>{ await p.evaluate(()=>acSetFeed('following')); }],
    ['Post detail', async()=>{ await p.evaluate(id=>acOpenPostView(id), pr[0].id); }],
    ['Beam chat list', async()=>{ await p.evaluate(()=>appTab('chat')); }],
    ['Notifications', async()=>{ await p.evaluate(()=>{closeOverlay('notifOverlay');acNavNotifs();}); }],
    ['Engine / search', async()=>{ await p.evaluate(()=>{closeOverlay('notifOverlay');appTab('search');}); }],
    ['Profile', async()=>{ await p.evaluate(h=>acGoProfile(h), other.h); }],
  ];
  let pass=0,fail=0,total=0;
  const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
  for(const [name,go] of surfaces){
    try{ await go(); }catch(e){ ok(false,name+' opens',String(e).slice(0,80)); continue; }
    await p.waitForTimeout(2600);
    const r=await p.evaluate(PROBE);
    total+=r.length;
    const bad=r.filter(x=>Math.abs(x.drift)>0.6);
    const seen={};
    r.forEach(x=>{const k=x.where+'|'+x.av+'|'+x.drift; if(seen[k])return; seen[k]=1;
      console.log('     '+String(x.drift).padStart(6)+'   picture '+x.av+'  text '+x.col+'   '+x.where);});
    ok(r.length>0, name+': a picture-beside-text row is on screen to test', r.length+' rows');
    ok(bad.length===0, name+': the name + handle share the picture\u2019s centre',
       bad.map(x=>x.where+' off by '+x.drift).join(' | '));
  }
  console.log('     '+total+' picture-beside-text rows measured');
  await b.close(); await pool.end();
  console.log('\n\u2550\u2550\u2550 '+pass+' passed, '+fail+' failed \u2550\u2550\u2550');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
