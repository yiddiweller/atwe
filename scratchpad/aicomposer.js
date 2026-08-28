process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?' :: '+String(x).slice(0,220):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='ac'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('Yiddi Weller',$1,$2,$3,true,true) RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  await p.evaluate(()=>appTab('ai')); await p.waitForTimeout(2000);

  // where does the NAV bar rest on a world that has one? that is the target line
  const navBottomGap = await p.evaluate(()=>{
    appTab('home');
    return new Promise(r=>setTimeout(()=>{
      const n=document.getElementById('bottomNav'); const q=n.getBoundingClientRect();
      r(+(innerHeight-q.bottom).toFixed(1));
    },1400));
  });
  console.log('  the nav bar rests '+navBottomGap+'px above the bottom of the screen');
  await p.evaluate(()=>appTab('ai')); await p.waitForTimeout(1800);

  const g=async(label)=>{
    const r=await p.evaluate(()=>{
      const w=document.getElementById('inputWrap'), box=document.getElementById('inputBox');
      const cw=getComputedStyle(w); const q=w.getBoundingClientRect(), bq=box.getBoundingClientRect();
      return {wrapBottom:+q.bottom.toFixed(1), boxBottom:+bq.bottom.toFixed(1),
        mb:cw.marginBottom, pb:cw.paddingBottom, pos:cw.position,
        gapUnderWrap:+(innerHeight-q.bottom).toFixed(1), gapUnderBox:+(innerHeight-bq.bottom).toFixed(1),
        vh:innerHeight};
    });
    console.log('  '+label+': '+JSON.stringify(r));
    return r;
  };
  const empty = await g('empty state');
  // now with a conversation open (the mode the founder screenshotted)
  await p.evaluate(()=>{ showMessages(); appendBubble('user','Can you give me step-by-step how to sell my product here?');
    const n=appendBubble('ai','',true); renderStream(n,"I'd be happy to help, but I need a bit more context."); });
  await p.waitForTimeout(900);
  const chat = await g('with a conversation');
  await p.screenshot({path:SP+'icons/AI-composer.png'});

  ok(chat.gapUnderBox <= navBottomGap + 4,
     'the composer rests at the bottom, level with where the nav bar sits ('+navBottomGap+'px)',
     'it sits '+chat.gapUnderBox+'px up — '+(chat.gapUnderBox-navBottomGap).toFixed(1)+'px too high');

  // the action row must be visible without touching anything
  const act = await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('#messages .msg.ai')];
    const last=rows[rows.length-1]; const a=last.querySelector('.msg-actions');
    return {op:getComputedStyle(a).opacity, busy:last.className,
      btns:a.querySelectorAll('button').length};
  });
  console.log('  action row: '+JSON.stringify(act));
  ok(parseFloat(act.op)===1, 'the copy / regenerate / thumbs row is visible without tapping anything', JSON.stringify(act));
  ok(act.btns>=4, 'and all four buttons are there', act.btns);
  // acShow() never runs for the AI page, so anything it manages leaks in from the last
  // world. The transparent tab-strip did exactly that and sat over this page's header.
  const leak = await p.evaluate(()=>{
    const st=document.getElementById('tbTabTouch'); const c=getComputedStyle(st);
    const r=st.getBoundingClientRect();
    const back=document.getElementById('tbAiBack').getBoundingClientRect();
    return {disp:c.display, pe:c.pointerEvents, pg:document.body.classList.contains('pgscroll'),
      overlapsHeader: c.display!=='none' && r.height>0 && r.top < back.bottom + 60};
  });
  console.log('  leaked chrome: '+JSON.stringify(leak));
  ok(!leak.pg, 'the mobile page-scroll mode is not left on over the AI page', JSON.stringify(leak));
  ok(leak.disp==='none', 'the tab-row touch strip is not left showing over the AI page', JSON.stringify(leak));
  // and the back arrow is genuinely reachable, not covered by anything
  const hit = await p.evaluate(()=>{
    const b=document.getElementById('tbAiBack').getBoundingClientRect();
    const el=document.elementFromPoint(Math.round(b.left+b.width/2), Math.round(b.top+b.height/2));
    if (!el) return 'none';
    // className on an SVG element is an SVGAnimatedString, not a string — stringifying it
    // gives "[object Object]" and tells you nothing. Ask whether the back button owns it.
    const btn = el.closest && el.closest('#tbAiBack');
    return (btn ? 'tbAiBack' : (el.id || el.tagName)) + '';
  });
  ok(/tbAiBack|tb-brand-back|svg|polyline/i.test(String(hit)), 'the back arrow is the thing under its own centre', 'found "'+hit+'"');
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
