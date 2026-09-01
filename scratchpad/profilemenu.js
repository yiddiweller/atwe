/* Tapping your own account in the top-right menu opens your PROFILE, not the editor.
   It used to call openProfileEdit() directly, so the only way to simply look at your own
   profile from there was to back out of a half-open form — and the row's chevron promises
   a destination, not a form. Editing is one tap further on, from the "Edit profile" button
   that the profile page already carries.
   This TAPS the real row rather than calling the opener, because the failure this guards
   is about where a tap lands. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP=__dirname+'/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};
(async()=>{
  const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
  const u='pm'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,verified)
    VALUES ($1,$2,$3,$4,true,true,true) RETURNING id`,['Menu Test',e,h,u]);
  const id=rows[0].id, t=auth.signToken({id,email:'x',is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
    localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6500);

  /* open the menu the way a member does — the real avatar button, never a synthetic
     event: _hideMenuSrcBtn sets opacity:0 on whatever is passed as the trigger, and
     handing it document.body blanks the whole screen (a trap this suite already records) */
  const opened=await p.evaluate(()=>{const btn=document.getElementById('tbBrandProf');
    if(!btn) return false; btn.click(); return true;});
  await p.waitForTimeout(900);
  ok(opened,'the top-right avatar is there to tap');
  ok(await p.evaluate(()=>!document.getElementById('profileMenu').classList.contains('hidden')),
     'tapping it opens the account menu');

  await p.evaluate(()=>document.querySelector('#profileMenu .pm-head').click());
  await p.waitForTimeout(2200);
  const st=await p.evaluate(()=>({
    editorOpen: !document.getElementById('profileOverlay').classList.contains('hidden'),
    profileOpen: (()=>{const s=document.getElementById('acProfileScreen');
      return !!s && getComputedStyle(s).display!=='none';})(),
    menuOpen: !document.getElementById('profileMenu').classList.contains('hidden'),
    editBtn: (()=>{const b=[...document.querySelectorAll('#acProfileScreen button')]
      .find(x=>/edit profile/i.test((x.textContent||'').trim()));
      return b ? getComputedStyle(b).display!=='none' : false;})(),
  }));
  ok(!st.editorOpen, 'it does NOT drop you straight into the edit form');
  ok(st.profileOpen, 'it opens your own profile page');
  ok(!st.menuOpen,   'and the menu closes behind you');
  ok(st.editBtn,     'the profile page offers "Edit profile" from there');

  /* and that button still opens the editor, or the edit route is simply gone */
  await p.evaluate(()=>{const b=[...document.querySelectorAll('#acProfileScreen button')]
    .find(x=>/edit profile/i.test((x.textContent||'').trim())); if(b) b.click();});
  await p.waitForTimeout(1600);
  ok(await p.evaluate(()=>!document.getElementById('profileOverlay').classList.contains('hidden')),
     'and tapping it does open the editor');
  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
