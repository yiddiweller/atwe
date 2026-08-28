/* The five changes in this round. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto'), fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='p3'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin) VALUES ('P',$1,$2,$3,true,true,true) RETURNING id`,[email,hash,h]);
  const uid=rows[0].id;
  const token=auth.signToken({id:uid,email,is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),uid]);
  await pool.query(`INSERT INTO at_messages (sender_id,recipient_id,body) VALUES ($1,$1,'hi')`,[uid]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);

  // ── 1 + 2 : Settings sign-out and the staff row ──
  await p.evaluate(()=>openSettings()); await p.waitForTimeout(1300);
  const so = await p.evaluate(()=>{
    const b=document.getElementById('hubSignout'); if(!b) return null;
    b.classList.remove('hidden');
    const cs=getComputedStyle(b), r=b.getBoundingClientRect();
    const svg=b.querySelector('svg'); const sr=svg?svg.getBoundingClientRect():null;
    const row=document.querySelector('#hubAdminGroup .iset-row');
    const lbl=row?row.querySelector('.iset-label'):null;
    const normal=document.querySelector('.iset-row:not(.iset-staff) .iset-label');
    return { align:cs.textAlign, radius:cs.borderRadius, hasIcon:!!svg,
      iconLeftOfText: !!(sr && sr.left < r.left + r.width/2),
      staffColor: lbl?getComputedStyle(lbl).color:null,
      normalColor: normal?getComputedStyle(normal).color:null };
  });
  ok(!!so, 'the Settings sign-out row exists');
  ok(so.align==='left' || so.align==='start', 'Sign out is left-aligned, like Log out on the Account page', so.align);
  ok(so.hasIcon && so.iconLeftOfText, 'and leads with its icon');
  ok(so.staffColor && so.normalColor && so.staffColor!==so.normalColor,
     'the Admin dashboard row is dimmer than a normal Settings row', so.staffColor+' vs '+so.normalColor);
  await p.screenshot({path:SP+'icons/P3-settings.png'});

  await p.evaluate(()=>{closeSettings();appTab('profile');}); await p.waitForTimeout(1600);
  const acc = await p.evaluate(()=>{
    const r=[...document.querySelectorAll('#acMeBody .me-row')].find(e=>/admin dashboard/i.test(e.textContent||''));
    const n=[...document.querySelectorAll('#acMeBody .me-row')].find(e=>/^Settings$/.test((e.textContent||'').trim()));
    return { staff:r?getComputedStyle(r.querySelector('.me-lbl')).color:null,
             normal:n?getComputedStyle(n.querySelector('.me-lbl')).color:null };
  });
  ok(acc.staff && acc.normal && acc.staff!==acc.normal,
     'and so is the one on the Account page', acc.staff+' vs '+acc.normal);

  // ── 3 : the Undo button is a real blue pill ──
  const undo = await p.evaluate(async()=>{
    acUndoToast('Message sent', 'Undo', ()=>{}, 8000);
    await new Promise(r=>setTimeout(r,500));
    const btn=document.querySelector('#acUndoToast .ut-btn'); if(!btn) return null;
    const cs=getComputedStyle(btn);
    return {bg:cs.backgroundColor, color:cs.color, radius:cs.borderRadius};
  });
  ok(!!undo, 'the undo toast shows');
  ok(undo && !/rgba\(0, 0, 0, 0\)/.test(undo.bg), 'Undo is a filled button, not plain text', undo&&undo.bg);
  ok(undo && /^rgb\(0, 13[0-9], 25[0-9]\)/.test(undo.bg), 'and the fill is the brand blue', undo&&undo.bg);
  await p.screenshot({path:SP+'icons/P3-undo.png'});
  await p.evaluate(()=>{const t=document.getElementById('acUndoToast'); if(t) t.remove();});

  // ── 4 : the notification toast ──
  const short = await p.evaluate(async()=>{
    showNotif('Saved'); await new Promise(r=>setTimeout(r,400));
    const n=[...document.querySelectorAll('.notif')].pop(); const cs=getComputedStyle(n);
    return {radius:cs.borderTopLeftRadius, border:cs.borderTopWidth, multi:n.classList.contains('notif-multi'),
            h:Math.round(n.getBoundingClientRect().height)};
  });
  ok(short.border==='0px', 'the toast has no outline', short.border);
  ok(!short.multi && parseFloat(short.radius)>40, 'a short toast is a capsule', JSON.stringify(short));
  await p.screenshot({path:SP+'icons/P3-toast-short.png'});
  await p.evaluate(()=>document.querySelectorAll('.notif').forEach(n=>n.remove()));

  const long = await p.evaluate(async()=>{
    showNotif('Thanks — your feedback was sent to the team and someone will read it shortly, then follow up with you here.');
    await new Promise(r=>setTimeout(r,400));
    const n=[...document.querySelectorAll('.notif')].pop(); const cs=getComputedStyle(n);
    return {radius:cs.borderTopLeftRadius, multi:n.classList.contains('notif-multi'),
            h:Math.round(n.getBoundingClientRect().height)};
  });
  ok(long.multi, 'a toast that wraps is marked as multi-line', JSON.stringify(long));
  ok(parseFloat(long.radius) < 40, 'and gets rounded corners instead of a capsule', long.radius);
  ok(long.h > short.h, 'and is genuinely taller (so this is really the wrapped case)', long.h+' vs '+short.h);
  await p.screenshot({path:SP+'icons/P3-toast-long.png'});
  await p.evaluate(()=>document.querySelectorAll('.notif').forEach(n=>n.remove()));

  // ── 5 : the Beam composer is evenly lit ──
  await p.evaluate((id)=>acOpenChat(id), uid); await p.waitForTimeout(2600);
  const f=SP+'icons/P3-beam.png'; await p.screenshot({path:f});
  const shade = await p.evaluate(()=>{const e=document.querySelector('.msg-inbox');const r=e.getBoundingClientRect();
    return {x:Math.round(r.left)+12,y:Math.round(r.top),h:Math.round(r.height)};});
  const png=PNG.sync.read(fs.readFileSync(f));
  const at=(x,y)=>{const i=(png.width*(y*2)+(x*2))<<2;return [png.data[i],png.data[i+1],png.data[i+2]];};
  const top=at(shade.x, Math.round(shade.y+shade.h*0.18)), bot=at(shade.x, Math.round(shade.y+shade.h*0.82));
  const d=(top[0]+top[1]+top[2])-(bot[0]+bot[1]+bot[2]);
  console.log('  composer pill: top '+top.join(',')+'  bottom '+bot.join(',')+'  (delta '+d+')');
  ok(Math.abs(d) <= 3, 'the composer pill is evenly lit top to bottom — the bottom fade no longer crosses it',
     'top '+top.join(',')+' vs bottom '+bot.join(','));

  ok(errs.length===0,'no JS errors',errs.join(' | '));
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
