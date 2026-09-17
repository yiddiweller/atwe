process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const QA=require('./qa-fixture');
// The fixture and the server MUST share a database. This used to be hardcoded, so the
// account was seeded somewhere the server could not see and the Account page measured
// as "0 sections, 0 rows, 0px tall". See qa-fixture.js.
const pool=QA.newPool();
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,400):''));}};
/* The labels the flat list had, straight out of the source. They arrive with literal
   \uXXXX escapes because that is how they are written in the file; the DOM shows the real
   character, so decode before comparing or every curly apostrophe reads as a loss. */
const ORIG = require('fs').readFileSync(require('path').join(__dirname,'me-labels.txt'),'utf8').split('\n').filter(Boolean)
  .map(l => l.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
(async()=>{
  const mk=(biz)=>QA.seedAccount(pool,{business:!!biz,admin:!!biz,onboarded:true,prefix:'mh'});
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  for (const [kind, biz] of [['business', true], ['personal', false]]) {
    const acct=await mk(biz);
    const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
    await QA.signIn(p, acct);                       // throws by name if the session is invisible to the server
    await p.evaluate(()=>appTab('profile'));
    // Wait for the Account page to REALLY render. Measuring it before it has rendered is
    // how "not yet" got reported as "empty".
    const rendered = await QA.waitUntil(p, ()=>{
      const s=document.getElementById('acMeScreen'), b=document.getElementById('acMeBody');
      if(!s||s.classList.contains('hidden')||getComputedStyle(s).display==='none') return false;
      const r=s.getBoundingClientRect();
      return r.width>100 && r.height>100 && !!b && b.querySelectorAll('.me-row').length>0;
    }, null, 20000);
    ok(rendered, 'the Account page renders before anything is measured on it');
    if(!rendered) throw new Error('Account page never rendered for @'+acct.username+' - refusing to measure an unrendered page');
    console.log('\n── '+kind+' account ──');

    const hub = await p.evaluate(()=>({
      /* Every row on the hub that opens a SECTION — the rows inside the sections card
         (.me-sec) AND any section promoted to its own card, which App & help now is.
         Keying off the onclick rather than the class is what keeps this honest: move a
         section to its own card and the walk still covers it. */
      sections:[...document.querySelectorAll('#acMeBody .me-row')]
        .filter(e=>/^acMeSection\(/.test(e.getAttribute('onclick')||''))
        .map(e=>({ title:e.querySelector('.me-lbl').textContent.trim(),
                   solo:!e.classList.contains('me-sec'),
                   id:(e.getAttribute('onclick').match(/'([^']+)'/)||[])[1]})),
      rows:document.querySelectorAll('#acMeBody .me-row').length,
      scrollH:document.getElementById('acMeBody').scrollHeight, viewH:innerHeight}));
    console.log('  top level: '+hub.sections.length+' sections, '+hub.rows+' rows total, page is '+hub.scrollH+'px tall (screen '+hub.viewH+')');
    hub.sections.forEach(s=>console.log('     · '+s.title+(s.solo?'  (its own card)':'')));
    ok(hub.sections.length>=8 && hub.sections.length<=13, 'the Account page is a short list of sections', hub.sections.length+' sections');
    ok(hub.rows <= 16, 'the top level is not a long scroll any more (was 98 rows)', hub.rows+' rows');

    // every destination still reachable, section by section
    const seen=new Set(); const opens=[];
    for (const sec of hub.sections) {
      const r = await p.evaluate(async(id)=>{ acMeSection(id); await new Promise(r=>setTimeout(r,220));
        const body=document.getElementById('acMeBody');
        return {title:(body.querySelector('.me-sectitle')||{}).textContent,
          back:!!body.querySelector('.me-secback'),
          labels:[...body.querySelectorAll('.me-row .me-lbl')].map(e=>e.textContent.trim())};}, sec.id);
      r.labels.forEach(l=>seen.add(l));
      opens.push(r.title+':'+r.labels.length);
      ok(r.back && r.labels.length>0, '  “'+sec.title+'” opens with a back arrow and '+r.labels.length+' rows', JSON.stringify(r).slice(0,200));
    }
    // back to the hub — by the arrow, and by the phone's own Back gesture
    await p.evaluate(()=>document.querySelector('#acMeBody .me-secback').click()); await p.waitForTimeout(900);
    const backHub = await p.evaluate(()=>[...document.querySelectorAll('#acMeBody .me-row')].filter(e=>/^acMeSection\(/.test(e.getAttribute('onclick')||'')).length);
    ok(backHub===hub.sections.length, '  back from a section returns to the section list', backHub);
    const sysBack = await p.evaluate(async()=>{ acMeSection('money'); await new Promise(r=>setTimeout(r,300));
      const inSec=!!document.querySelector('#acMeBody .me-sectitle');
      appGoBack(); await new Promise(r=>setTimeout(r,600));
      return {inSec, secs:[...document.querySelectorAll('#acMeBody .me-row')].filter(e=>/^acMeSection\(/.test(e.getAttribute('onclick')||'')).length,
        stillOnAccount:!document.getElementById('acMeScreen').classList.contains('hidden')};});
    ok(sysBack.inSec && sysBack.secs===hub.sections.length && sysBack.stillOnAccount,
       "  the phone's Back gesture returns to the section list, not out of the page", JSON.stringify(sysBack));
    // re-tapping the Account tab pops back to the top, like tapping a tab twice on iPhone
    const retap = await p.evaluate(async()=>{ acMeSection('selling'); await new Promise(r=>setTimeout(r,300));
      appTab('profile'); await new Promise(r=>setTimeout(r,900));
      return [...document.querySelectorAll('#acMeBody .me-row')].filter(e=>/^acMeSection\(/.test(e.getAttribute('onclick')||'')).length;});
    ok(retap===hub.sections.length, '  tapping Account again pops back to the section list', retap);
    if (kind==='business') { await p.evaluate(()=>acMeSection('money')); await p.waitForTimeout(500);
      await p.screenshot({path:'/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/icons/ME-section.png'});
      await p.evaluate(()=>acGoProfileHub()); await p.waitForTimeout(600); }

    // NOTHING LOST: every label the flat list had must still exist somewhere
    if (kind==='business') {
      const norm=x=>x.replace(/\s+/g,' ').trim();
      const have=new Set([...seen].map(norm));
      const hubRows = await p.evaluate(()=>[...document.querySelectorAll('#acMeBody .me-row:not(.me-sec) .me-lbl')].map(e=>e.textContent.trim()));
      hubRows.forEach(l=>have.add(norm(l)));
      /* Five rows LEFT the Account page on purpose when App-and-help became
         Help-and-feedback: everything about running the app moved into Settings. They
         are not losses, so they are excluded here — but the exclusion is not a free
         pass. Each one must still be findable from the app-wide search bar, which is
         where it now lives, so the check still fails if any genuinely vanishes. */
      const MOVED = {
        /* old label            -> [ the label it carries now, where it lives ] */
        'Notifications':        ['Notifications',       'the nav bell, and Settings \u203a Notifications'],
        /* the Settings row has always had the fuller name; the bare one was the duplicate */
        'Devices':              ['Devices & sessions',  'Settings \u203a Security & access'],
        'What\u2019s new':          ['What\u2019s new',         'Settings, beside About & legal'],
        'Posts you\u2019ve read':   ['Posts you\u2019ve read',  'Settings \u203a Your data & storage'],
        'Ask about your data':  ['Ask about your data', 'Settings \u203a Atwe Assistant'],
      };
      const movedNorm = Object.keys(MOVED).map(norm);
      const missing = ORIG.filter(l=>l!=='PLAN').map(norm)
        .filter(l=>!have.has(l) && !movedNorm.includes(l));
      ok(missing.length===0, '  every destination the old flat list had is still reachable', 'missing: '+JSON.stringify(missing));
      console.log('  reachable destinations: '+have.size+' on the Account page, +'+movedNorm.length+' moved to Settings');
      /* Searching the OLD name is now how you reach each of them, so that is what is
         asserted — type what you used to see on the Account page and the destination
         must come back. Remove one from the index and this fails. */
      const found = await p.evaluate(pairs=>pairs.map(([old, now])=>{
        const hits = acFindPlaces(old, 6).map(r=>r.label.trim());
        return {old, now, hits: hits.slice(0,3), ok: hits.includes(now)};
      }), Object.entries(MOVED).map(([o,[n]])=>[o,n]));
      const lost = found.filter(f=>!f.ok).map(f=>f.old+' (want "'+f.now+'", got '+JSON.stringify(f.hits)+')');
      ok(lost.length===0, '  searching a moved row\u2019s old name still finds it', JSON.stringify(lost));
      Object.entries(MOVED).forEach(([l,[now,where]])=>
        console.log('     \u00b7 '+l+' \u2192 '+where+(now===l?'':'  (now called \u201c'+now+'\u201d)')));
    }

    // search must still find them, with the section as the subtitle
    const srch = await p.evaluate(()=>{
      const probes=['gift cards','resumes','the till','call recordings','saved candidates','addresses','webinars','payment links'];
      return probes.map(q=>{const r=acFindPlaces(q,3)[0]; return {q, hit:r?r.label:null, sub:r?r.sub:null};});
    });
    const bad = srch.filter(r=>!r.hit);
    ok(bad.length===0, '  search still finds buried destinations', JSON.stringify(bad));
    console.log('     e.g. ' + srch.slice(0,3).map(r=>`"${r.q}" → ${r.hit} (${r.sub})`).join('  |  '));
    ok(errs.length===0,'  no JS errors',errs[0]);
    if (kind==='business') await p.screenshot({path:SP+'icons/ME-hub.png'});
    await p.close();
  }
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
