/* A NON-admin must see no Admin dashboard row at all — and the sections card must
   still end cleanly, with Log out still alone in its own card below it. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='na'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin) VALUES ('N',$1,$2,$3,true,true,false) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1500);
  const r = await p.evaluate(()=>{
    const body=document.getElementById('acMeBody');
    const groups=[...body.querySelectorAll('.me-group')];
    const txt=e=>(e.textContent||'').replace(/\s+/g,' ').trim();
    const last=groups[groups.length-1], secs=groups[0];
    return { isAdmin: !!(S.user||{}).is_admin,
      anyAdminRow: [...body.querySelectorAll('.me-row')].some(e=>/admin dashboard/i.test(txt(e))),
      groups: groups.length,
      secLastIsSection: secs ? (secs.lastElementChild||{}).classList?.contains('me-sec') : null,
      tail: groups[1]?[...groups[1].children].map(txt):[],
      foot: last?[...last.children].map(txt):[],
      inSearch: (acFindPlaces('admin dashboard',8)||[]).some(x=>/^Admin dashboard/i.test(x.label)) };
  });
  console.log('  '+JSON.stringify(r));
  ok(r.isAdmin===false, 'this account is genuinely not an admin (else the check proves nothing)');
  ok(r.anyAdminRow===false, 'no Admin dashboard row anywhere on the Account page');
  ok(r.secLastIsSection===true, 'the sections card ends on a real section row');
  ok(r.groups===4, 'still one card each: sections, Settings, App & help, Log out', 'groups='+r.groups);
  ok(r.tail.length===1 && /^Settings$/.test(r.tail[0]||''),
     'the tail card holds Settings only \u2014 no empty Admin slot', JSON.stringify(r.tail));
  ok(r.foot.length===1 && /log out/i.test(r.foot[0]||''), 'Log out still stands alone below', JSON.stringify(r.foot));
  ok(r.inSearch===false, 'and search does not offer it either');
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
