// The bar must sit ABOVE the Alerts panel (it is a tab) and UNDER every other
// panel, exactly as it did before the move.
process.env.JWT_SECRET = 'scoresecret';
const crypto = require('crypto');
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const { Pool } = require('/home/user/atwe/node_modules/pg');
const auth = require('/home/user/atwe/auth');
const pool = new Pool({ connectionString: 'postgres://atwe:atwe@localhost:5432/atwescore' });
let pass=0, fail=0;
const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+x:''));} };
(async () => {
  const email=crypto.randomUUID().slice(0,8)+'@t.local', hash=await auth.hashPassword('x'.repeat(12));
  const h='nl'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,balance_cents) VALUES ('L',$1,$2,$3,true,true,5000) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  await pool.query("INSERT INTO notifications (user_id, actor_id, type, created_at) VALUES ($1,$1,'follow',now())",[rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4500);
  const navTop = () => p.evaluate(() => {
    const n=document.getElementById('bottomNav'); const r=n.getBoundingClientRect();
    const e=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
    return { covered: !(e && n.contains(e)), by: e ? (e.id||e.tagName)+'.'+String(e.className.baseVal ?? e.className).trim().split(/\s+/)[0] : 'nothing' };
  });
  await p.evaluate(()=>appTab('home')); await p.waitForTimeout(1000);
  ok(!(await navTop()).covered, 'the bar is tappable on Home');
  await p.evaluate(()=>acNavNotifs()); await p.waitForTimeout(1500);
  const a = await navTop();
  ok(!a.covered, 'the bar stays tappable while Alerts is open', a.by);
  await p.screenshot({ path: SP+'icons/app-alerts-with-nav.png' });
  // tapping another world from inside Alerts must actually leave
  await p.click('#bnav-home'); await p.waitForTimeout(1400);
  const left = await p.evaluate(() => ({
    overlayHidden: document.getElementById('notifOverlay').classList.contains('hidden'),
    homeActive: document.getElementById('bnav-home').classList.contains('active'),
    notifActive: document.getElementById('bnav-notifs').classList.contains('active'),
    bodyClass: document.body.classList.contains('notif-tab'),
  }));
  ok(left.homeActive && !left.notifActive, 'tapping Home from Alerts moves the highlight back');
  ok(!left.bodyClass, 'the notif-tab flag is cleared on leaving', JSON.stringify(left));
  // and every OTHER panel must still cover the bar, as before
  await p.evaluate(()=>acOpenWallet()); await p.waitForTimeout(1600);
  const w = await navTop();
  ok(w.covered, 'the Wallet panel still covers the bar (unchanged behaviour)', w.by);
  await p.evaluate(()=>{document.querySelectorAll('.overlay:not(.hidden)').forEach(o=>closeOverlay(o.id));}); await p.waitForTimeout(800);
  await p.evaluate(()=>openSettings()); await p.waitForTimeout(1400);
  const st = await navTop();
  ok(st.covered, 'Settings still covers the bar (unchanged behaviour)', st.by);
  ok(errs.length===0, 'no JS errors', errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(2);});
