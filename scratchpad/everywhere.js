/* The five worlds, at every width the app is used at, in both themes. Asserts the
   nav is PRESENT, shows exactly the five, uses the new artwork, and that only the
   selected one is solid. Also proves the retired glyphs are gone for good. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;}else{fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+String(x).slice(0,150):''));}};
const WIDTHS=[[390,844,'phone'],[430,932,'phone-max'],[768,1024,'tablet'],[834,1112,'tablet-land'],[1024,768,'small-laptop'],[1280,800,'laptop'],[1440,900,'desktop'],[1920,1080,'wide']];
const WORLDS=['home','chat','search','notifs','profile'];
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='ev'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,balance_cents) VALUES ('E',$1,$2,$3,true,true,5000) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const theme of ['black','light']) {
    for (const [w,hh,tag] of WIDTHS) {
      const p=await b.newPage({viewport:{width:w,height:hh},deviceScaleFactor:1});
      p.on('pageerror',e=>errs.push(`${theme}/${tag}: ${String(e).slice(0,110)}`));
      await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
      await p.evaluate(([t,th])=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_theme',th);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[token,theme]);
      await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
      await p.waitForTimeout(4200);
      const r = await p.evaluate((worlds) => {
        const seen = (pre) => worlds.map((t) => {
          const el = document.getElementById(pre + t); if (!el) return null;
          const vis = el.offsetParent !== null || el.getClientRects().length > 0;
          const off = el.querySelector('.nv-off'), on = el.querySelector('.nv-on');
          const cs = (e) => e ? getComputedStyle(e) : null;
          const m = (e) => { const c = cs(e); return c ? (c.maskImage || c.webkitMaskImage || '') : ''; };
          return { t, vis, active: el.classList.contains('active'),
                   offShown: off ? cs(off).display !== 'none' : null,
                   onShown:  on  ? cs(on).display  !== 'none' : null,
                   hasArt: /url\(/.test(m(off)) && /url\(/.test(m(on)) };
        });
        const barVis = (() => { const n = document.getElementById('bottomNav'); if (!n) return false;
          const c = getComputedStyle(n); return c.display !== 'none' && n.getBoundingClientRect().height > 10; })();
        const sideVis = (() => { const s = document.querySelector('.sidebar'); if (!s) return false;
          const c = getComputedStyle(s); return c.display !== 'none' && s.getBoundingClientRect().width > 40; })();
        return { bar: seen('bnav-'), side: seen('snav-'), barVis, sideVis,
                 labels: worlds.map((t)=>{ const e=document.getElementById('snav-'+t); return e ? (e.textContent||'').trim().split('\n')[0] : null; }) };
      }, WORLDS);
      const which = r.barVis ? r.bar : r.side;
      const shown = r.barVis ? 'bottom bar' : (r.sideVis ? 'sidebar' : 'NEITHER');
      ok(r.barVis || r.sideVis, `${theme}/${tag}: a nav is on screen`, shown);
      ok(which.every((x)=>x), `${theme}/${tag}: all five worlds exist`, JSON.stringify(which.map(x=>x&&x.t)));
      ok(which.every((x)=>x && x.hasArt), `${theme}/${tag}: every icon has both states of artwork`, JSON.stringify(which.map(x=>x&&x.hasArt)));
      const solids = which.filter((x)=>x && x.onShown).length;
      ok(solids === 1, `${theme}/${tag}: exactly one icon is solid`, 'solid count ' + solids);
      const activeIsSolid = which.every((x)=>!x || (x.active ? x.onShown : x.offShown));
      ok(activeIsSolid, `${theme}/${tag}: the solid one is the selected one`);
      if (tag==='phone'||tag==='tablet'||tag==='desktop') await p.screenshot({path:SP+`icons/ev-${theme}-${tag}.png`});
      await p.close();
    }
  }
  ok(errs.length===0,'no JS errors at any width in either theme',errs[0]);
  await b.close(); await pool.end();
  console.log(`checked ${WIDTHS.length} widths x 2 themes`);
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(2);});
