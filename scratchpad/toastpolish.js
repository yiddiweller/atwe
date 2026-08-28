/* The two toasts, after the owner's notes:
   · the top notice is wide, centred and rounded, and TRAVELS in from above
   · the Undo pill sits evenly inside the grey pill on all four sides */
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
const LONG='Thanks — your feedback was sent to the team and someone will read it shortly, then follow up with you here.';
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const theme of ['black','light']) {
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(t=>localStorage.setItem('atwe_theme',t),theme);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(4000);
    console.log('\n── '+theme+' ──');

    const wide=await p.evaluate(async(msg)=>{
      document.querySelectorAll('.notif').forEach(n=>n.remove());
      showNotif(msg); await new Promise(r=>setTimeout(r,500));
      const el=document.querySelector('.notif'), b=el.getBoundingClientRect(), cs=getComputedStyle(el);
      return {w:Math.round(b.width), vw:innerWidth, align:cs.textAlign,
              r:Math.round(parseFloat(cs.borderRadius)), multi:el.classList.contains('notif-multi'),
              lines:Math.round((b.height-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom))/parseFloat(cs.lineHeight))};
    }, LONG);
    /* The old box was anchored at left:50% with no right edge, so it could only ever use
       the half-viewport to its right — 50% of the screen, which is what the owner circled. */
    ok(wide.w/wide.vw >= 0.88, 'a long notice fills the width instead of half the screen',
       wide.w+'px of '+wide.vw+' ('+Math.round(100*wide.w/wide.vw)+'%)');
    ok(wide.align==='center', 'and its text is centred, not pinned to one side', wide.align);
    ok(wide.multi && wide.r>=24 && wide.r<200, 'with the app’s own card corner, not a stadium and not 20px', 'radius '+wide.r);
    ok(wide.lines<=3, 'and it needs fewer lines because it is wider', wide.lines+' lines');

    const shortT=await p.evaluate(async()=>{
      document.querySelectorAll('.notif').forEach(n=>n.remove());
      showNotif('Message sent'); await new Promise(r=>setTimeout(r,500));
      const el=document.querySelector('.notif'), cs=getComputedStyle(el);
      return {r:Math.round(parseFloat(cs.borderRadius)), align:cs.textAlign,
              multi:el.classList.contains('notif-multi'), w:Math.round(el.getBoundingClientRect().width)};
    });
    ok(!shortT.multi && shortT.r>100, 'a one-line notice is still a capsule that hugs its text', JSON.stringify(shortT));

    /* It must TRAVEL in from above, not appear in place. Measured on a FRESH page: an
       earlier version cleared the toasts with removeChild, which left them in
       _toastStack — the restack then pushed each new toast 10px further down, and the
       probe read that drift as the animation. It passed on a 2px slide. */
    const fresh=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    await fresh.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await fresh.waitForTimeout(4000);
    const travel=await fresh.evaluate(async()=>{
      const tops=[]; showNotif('Message sent');
      const el=document.querySelector('.notif');
      for(let i=0;i<11;i++){ await new Promise(r=>requestAnimationFrame(r));
        tops.push({y:+el.getBoundingClientRect().top.toFixed(1), o:+(+getComputedStyle(el).opacity).toFixed(2)}); }
      await new Promise(r=>setTimeout(r,420));
      tops.push({y:+el.getBoundingClientRect().top.toFixed(1), o:1});
      return tops;
    });
    await fresh.close();
    const ys=travel.map(t=>t.y), moved=Math.max(...ys)-Math.min(...ys);
    ok(moved>=14, 'it slides down into place rather than popping', 'travelled '+moved.toFixed(1)+'px  '+JSON.stringify(ys));
    ok(travel[0].o<0.75, 'and fades as it comes', 'first sampled opacity '+travel[0].o);

    const undo=await p.evaluate(async()=>{
      acUndoToast('Message sent','Undo',()=>{}); await new Promise(r=>setTimeout(r,450));
      const t=document.querySelector('.undo-toast'), btn=t.querySelector('.ut-btn');
      const T=t.getBoundingClientRect(), B=btn.getBoundingClientRect();
      return {right:Math.round(T.right-B.right), top:Math.round(B.top-T.top), bottom:Math.round(T.bottom-B.bottom),
              outerR:T.height/2, innerR:B.height/2};
    });
    ok(undo.right===undo.top && undo.top===undo.bottom,
       'the Undo pill has the same gap on the right as above and below', JSON.stringify(undo));
    /* Both shapes are fully round, so equal gaps is also exactly the condition for the
       two capsules to be concentric: outer radius = inner radius + gap. */
    ok(Math.abs((undo.outerR - undo.innerR) - undo.right) <= 0.6,
       'which makes the two capsules concentric', 'outer '+undo.outerR+' inner '+undo.innerR+' gap '+undo.right);
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
