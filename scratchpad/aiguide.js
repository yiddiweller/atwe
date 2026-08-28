// Everything about "Atwe AI knows the app" that does NOT need a live API key:
// the guide it is given, the markers it may send back, and whether the buttons
// those markers produce actually go anywhere.
process.env.JWT_SECRET = 'scoresecret';
const crypto = require('crypto');
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const { Pool } = require('/home/user/atwe/node_modules/pg');
const auth = require('/home/user/atwe/auth');
const pool = new Pool({ connectionString: 'postgres://atwe:atwe@localhost:5432/atwescore' });
let pass=0, fail=0;
const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+String(x).slice(0,180):''));} };
(async () => {
  const email=crypto.randomUUID().slice(0,8)+'@t.local', hash=await auth.hashPassword('x'.repeat(12));
  const h='ag'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,balance_cents) VALUES ('G',$1,$2,$3,true,true,5000) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844}});
  p.on('pageerror',e=>errs.push(String(e).slice(0,150)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4500);

  // ── the guide ──
  const g = await p.evaluate(() => { const s = acAiGuide(); return { chars: s.length, lines: s.split('\n').length, sample: s.split('\n').slice(0,3) }; });
  console.log('  guide:', g.lines, 'destinations,', g.chars, 'characters');
  ok(g.lines > 100, 'the assistant is given the whole app (' + g.lines + ' destinations)');
  ok(g.chars < 12000, 'and it fits inside the cap the server enforces (' + g.chars + ' < 12000)');
  ok(/^- .+ \(.+\)$/.test(g.sample[0]), 'each line is "Name (section)"', g.sample[0]);
  for (const must of ['Wallet','Settings','Notifications','Orders','Beam']) {
    const has = await p.evaluate((w) => acAiGuide().toLowerCase().includes(w.toLowerCase()), must);
    ok(has, 'the guide mentions ' + must);
  }

  // ── the markers ──
  const t1 = await p.evaluate(() => acAiOpenTargets('Your money lives in the Wallet.\n\n[[open:Wallet]]'));
  ok(t1.clean === 'Your money lives in the Wallet.', 'the marker is stripped from what you read', t1.clean);
  ok(t1.targets.length === 1 && /wallet/i.test(t1.targets[0].label), 'and resolves to the real Wallet', JSON.stringify(t1.targets.map(x=>x.label)));

  const t2 = await p.evaluate(() => acAiOpenTargets('Try these.\n[[open:Wallet]]\n[[open:Orders]]'));
  ok(t2.targets.length === 2, 'several markers give several buttons', t2.targets.map(x=>x.label).join(', '));

  const t3 = await p.evaluate(() => acAiOpenTargets('Go to [[open:A Place That Does Not Exist At All Zzz]]'));
  ok(t3.targets.length === 0, 'a made-up destination produces NO button', JSON.stringify(t3.targets));

  const t4 = await p.evaluate(() => acAiOpenTargets('Just a normal answer with no places in it.'));
  ok(t4.targets.length === 0 && t4.clean.includes('normal answer'), 'an ordinary answer is untouched');

  const t5 = await p.evaluate(() => acAiOpenTargets('[[open:Wallet]]\n[[open:Wallet]]'));
  ok(t5.targets.length === 1, 'the same place twice still gives one button');

  // ── the buttons actually navigate ──
  const nav = await p.evaluate(async () => {
    const { targets } = acAiOpenTargets('[[open:Wallet]]');
    const host = document.createElement('div'); const bub = document.createElement('div');
    host.appendChild(bub); document.body.appendChild(host);
    acAiRenderOpen(bub, targets);
    const btn = host.querySelector('.ai-open-btn');
    const label = btn ? btn.textContent : null;
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 1400));
    const open = [...document.querySelectorAll('.overlay:not(.hidden)')].map((o) => o.id);
    host.remove();
    return { label, open };
  });
  ok(nav.label === 'Open Wallet', 'the button is labelled "Open Wallet"', nav.label);
  ok(nav.open.includes('walletView'), 'tapping it really opens the Wallet', nav.open.join(','));
  ok(errs.length === 0, 'no JS errors', errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(2);});
