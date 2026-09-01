/* SOLID, NEVER HOLLOW — the app's own design rule 3, applied to the buttons that were
   quietly breaking it. The founder photographed five screens and said the buttons looked
   thin next to the profile editor's Save, which they named as the one that was already
   right. Measuring every text button against it showed the real difference was not height:
   Save is 32px and one of the SHORTER buttons in the app. It is that Save is SOLID, while
   the ones they marked were hollow — a 1.5px outline with nothing inside — or, in the case
   of .ac-pill-btn (the secondary button used all over the app), transparent with its grey
   fill on :hover only. A phone has no hover, so every secondary action rendered as bare
   floating text with no button around it at all.

   Two things are asserted here: no text button is hollow, and none is shorter than Save. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP=__dirname+'/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};

/* Deliberately NOT buttons-in-a-pill, and each for a stated reason. */
const EXEMPT = new Set([
  'tb-feedtab',   // a tab strip: a word on the page, the active one bolded. Not a pill.
  'bn-tab',       // the bottom nav's five worlds — icons, and the bar is the button
  'tb-brand',     // the Atwe lockup, not a control
  'ac-link-btn',  // a LINK ("+ New pot"), and reads as one on purpose
  'pf-ai',        // floats inside a field's label line; a 32px floor would break that row
  'ac-like',      // a feed post's action pill — its own sizing, covered by postcard.js
  'ac-trend',     // a trending row, full-width
  'sb-btn','sb-settings','me-row','iset-row','wallet-cardrow','story-cell','xp-tile',
  'xp-ai','me-hero','me-wallet','circ2-sec','wallet-cashout','mkt-buy',  // rows and cards
]);
(async()=>{
  const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
  const u='bs'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,verified,account_type,is_admin)
    VALUES ($1,$2,$3,$4,true,true,true,'business',true) RETURNING id`,['Button Sweep',e,h,u]);
  const id=rows[0].id, t=auth.signToken({id,email:'x',is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for(const theme of ['black','light']){
    console.log('\n══ '+theme+' ══');
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
      localStorage.setItem('atwe_theme',th);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(6500);

    const seen=new Map();
    const sweep=async(where)=>{
      const found=await p.evaluate(()=>{
        const out=[];
        for(const el of document.querySelectorAll('button')){
          const c=getComputedStyle(el), r=el.getBoundingClientRect();
          if(c.display==='none'||c.visibility==='hidden'||+c.opacity===0) continue;
          if(r.width<40||r.height<8||r.top<-40||r.top>820) continue;
          const txt=(el.textContent||'').trim();
          if(!txt||txt.length>28) continue;         // icon-only and long rows are not pills
          if(r.width > innerWidth*0.62) continue;   // full-width rows/cards are not pills
          const rad=parseFloat(c.borderTopLeftRadius)||0;
          if(rad < 10) continue;                    // square things are chips/inputs
          const bg=c.backgroundColor||'';
          const m=bg.match(/rgba?\(([^)]+)\)/);
          const alpha=m ? (m[1].split(',')[3]!==undefined ? parseFloat(m[1].split(',')[3]) : 1) : 0;
          out.push({cls:(String(el.className).trim().split(/\s+/)[0])||'button',
                    h:+r.height.toFixed(1), bg, alpha, txt:txt.slice(0,16)});
        }
        return out;
      });
      /* keyed by class AND fill, not class alone: .ac-pill-btn has a solid .accent variant
         and a plain one, and keying on the class would check whichever appeared first and
         never look at the other — which is the very variant that was hollow. */
      for(const f of found){const k=f.cls+'|'+f.bg; if(!seen.has(k)) seen.set(k,{...f,where});}
    };
    const go=async(label,fn,wait)=>{ try{ await p.evaluate(f=>eval(f),fn); }catch(e){ return; }
      await p.waitForTimeout(wait||1500); await sweep(label);
      await p.evaluate(()=>{const o=[...document.querySelectorAll('.overlay:not(.hidden)')].pop(); if(o) closeOverlay(o.id);});
      await p.waitForTimeout(450); };
    await sweep('home');
    await p.evaluate(()=>acSetFeed('circles')); await p.waitForTimeout(2400); await sweep('circles');
    await p.evaluate(()=>acSetFeed('foryou')); await p.waitForTimeout(1000);
    await go('wallet','acOpenWallet()');
    await go('marketplace','acOpenMarketplace()');
    await go('events','acOpenEvents()');
    await go('orders',"acOpenOrders('buyer')");
    await go('network','acOpenConnections()');
    await go('advertise','acOpenAdCreate()');
    await go('bookings','acOpenBookings()');
    await p.evaluate(()=>appTab('profile')); await p.waitForTimeout(1800); await sweep('account');

    const all=[...seen.values()].filter(x=>!EXEMPT.has(x.cls));
    ok(all.length>=8, 'found buttons to check across the app', all.length+' distinct kinds');
    const hollow=all.filter(x=>x.alpha < 0.06);
    ok(hollow.length===0, 'no text button is hollow — every one has a real fill',
       hollow.map(x=>x.cls+' ('+x.where+' / "'+x.txt+'")').slice(0,4).join(', ')||'none');
    const short=all.filter(x=>x.h < 31.5);
    ok(short.length===0, 'and none is shorter than the Save button the founder liked (32px)',
       short.map(x=>x.cls+' '+x.h+'px').slice(0,4).join(', ')||'none');
    if(process.env.LIST||fail) for(const x of all) console.log('       '+x.cls.padEnd(18)+String(x.h).padStart(6)+'  '+x.bg+'  '+x.where);
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
