process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+String(x).slice(0,200):''));}};
const TYPES=['follow','like','reply','mention','connection','endorse','repost','profile_update','event_rsvp','qa_answer','team_invite','recommendation'];
(async()=>{
  const mk=async(pfx)=>{const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
    const h=pfx+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ($4,$1,$2,$3,true,true) RETURNING id`,[email,hash,h,'User '+pfx+h.slice(2,6)]);
    return {id:rows[0].id,email,h};};
  const me=await mk('nh');
  const token=auth.signToken({id:me.id,email:me.email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),me.id]);
  // varied types AND distinct actors — identical rows GROUP into one row and the list
  // then has nothing to scroll, which makes a working retraction look broken.
  for (let i=0;i<26;i++){ const a=await mk('ac');
    await pool.query("INSERT INTO notifications (user_id,actor_id,type,read,created_at) VALUES ($1,$2,$3,false,now() - ($4||' minutes')::interval)",[me.id,a.id,TYPES[i%TYPES.length],i]); }

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);

  // ── reference: where the title sits on Home / Beam / Engine ──
  // Home is NOT a reference: it shows the Atwe logotype, not a word, so
  // .tb-brand-word-txt is empty there (height 0) and reports top=0. Beam and Engine
  // are the two worlds that render an actual title, so they are what must be matched.
  const ref={};
  for (const [w,sel] of [['Beam','#tbBrandRow .tb-brand-word-txt'],['Engine','#tbBrandRow .tb-brand-word-txt']]) {
    await p.evaluate(t=>appTab(t), w==='Beam'?'chat':'search'); await p.waitForTimeout(1600);
    // Reset the scroll AND the collapsing header's transform first: a top bar left
    // scroll-collapsed from an earlier step reports top=0 and is not a valid reference.
    await p.evaluate(()=>{
      const se=document.scrollingElement; if(se) se.scrollTop=0;
      ['acFeed','acList','acSearchScroll'].forEach(id=>{const e=document.getElementById(id); if(e) e.scrollTop=0;});
      const tb=document.querySelector('.topbar'); if(tb) tb.style.transform='';
      window.dispatchEvent(new Event('scroll'));
    });
    await p.waitForTimeout(700);
    ref[w]=await p.evaluate(s=>{const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return +r.top.toFixed(1);},sel);
  }
  console.log('title top on:  Beam='+ref.Beam+'  Engine='+ref.Engine+'   (Home shows the logotype, not a word)');

  // ── Notifications ──
  await p.evaluate(()=>appTab('home')); await p.waitForTimeout(1200);
  await p.click('#bnav-notifs'); await p.waitForTimeout(2000);
  const n0=await p.evaluate(()=>{
    const t=document.querySelector('#notifHead .tb-brand-word-txt');
    const list=document.getElementById('notifList');
    const head=document.getElementById('notifHead');
    return {title:+t.getBoundingClientRect().top.toFixed(1), text:t.textContent.trim(),
      headTop:+head.getBoundingClientRect().top.toFixed(1),
      pos:getComputedStyle(head).position,
      rows:list?list.children.length:0,
      scrollable: list? (list.scrollHeight - list.clientHeight) : 0};
  });
  console.log('Notifications: title top='+n0.title+'  rows='+n0.rows+'  scrollable by '+n0.scrollable+'px  header position='+n0.pos);
  const refs=[ref.Beam,ref.Engine].filter(v=>v!=null && v>0);
  const agree = refs.length===2 && Math.abs(refs[0]-refs[1])<=1;
  ok(agree, 'Beam and Engine agree on the title height (else the reference is unusable)', JSON.stringify(ref));
  ok(agree && Math.abs(n0.title-refs[0])<=1, 'the Notifications title sits at the same height as Beam / Engine', 'notifs='+n0.title+' vs '+JSON.stringify(ref));
  ok(n0.scrollable>120, 'the list genuinely scrolls (otherwise the retraction cannot be judged)', 'only '+n0.scrollable+'px');

  // ── does it roll away on scroll? ──
  const roll=await p.evaluate(async()=>{
    const list=document.getElementById('notifList'), head=document.getElementById('notifHead');
    const before=head.getBoundingClientRect().top;
    list.scrollTop=260; list.dispatchEvent(new Event('scroll'));
    await new Promise(r=>setTimeout(r,600));
    const after=head.getBoundingClientRect().top;
    const cls=document.getElementById('notifOverlay').classList.contains('nh-hide');
    const op=getComputedStyle(head).opacity;
    return {before:+before.toFixed(1), after:+after.toFixed(1), nhHide:cls, opacity:op};
  });
  console.log('on scroll: header top '+roll.before+' -> '+roll.after+'  (.nh-hide='+roll.nhHide+', opacity='+roll.opacity+')');
  ok(roll.nhHide, 'scrolling adds the retract class');
  ok(roll.after < roll.before - 20, 'the header actually MOVES up out of the way', roll.before+' -> '+roll.after);

  // ── the profile button ──
  await p.evaluate(()=>{const l=document.getElementById('notifList'); l.scrollTop=0; l.dispatchEvent(new Event('scroll'));});
  await p.waitForTimeout(600);
  await p.click('#notifHeadProf'); await p.waitForTimeout(900);
  const menu=await p.evaluate(()=>{
    const m=document.getElementById('profileMenu'); if(!m) return {missing:true};
    const r=m.getBoundingClientRect(), c=getComputedStyle(m);
    const ov=document.getElementById('notifOverlay');
    const cx=Math.round(r.left+r.width/2), cy=Math.round(r.top+Math.min(30,r.height/2));
    const top=document.elementFromPoint(cx,cy);
    return {open:!m.classList.contains('hidden'), z:c.zIndex, ovZ:getComputedStyle(ov).zIndex,
      vis:c.visibility, op:c.opacity, w:+r.width.toFixed(1), h:+r.height.toFixed(1),
      onTop: !!(top && m.contains(top)), topEl: top?(top.id||top.className||top.tagName):'none'};
  });
  console.log('profile menu: '+JSON.stringify(menu));
  ok(menu.open && menu.h>10, 'tapping the profile button opens the profile menu', JSON.stringify(menu));
  ok(menu.onTop, 'and the menu is actually ON TOP of the Notifications panel (not buried behind it)', 'point hits '+menu.topEl+'; menu z='+menu.z+' panel z='+menu.ovZ);
  await p.screenshot({path:SP+'icons/NOTIF-head.png'});
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
