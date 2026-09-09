/* docs/WEB-FINISH-LIST.md B1–B6 — the 44pt touch floor.
   Measures the box the BROWSER would hit (the ::before overlay included) and, just as
   importantly, that no overlay steals the tap of the control beside it: the cheap way to
   "pass" this check is to grow sideways over a neighbour, which trades one fault for a
   worse one. So every control is also hit-tested at its neighbour's centre. */
const SP=process.env.PW_SCRATCH||'/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'/node_modules/playwright-core');
const fs=require('fs');
const TOK=(process.env.TOK||(fs.existsSync('/tmp/tok.txt')?fs.readFileSync('/tmp/tok.txt','utf8'):'')).trim();
if(!TOK){ console.log('skipped — needs TOK'); process.exit(0); }
const CASES=[
 ['Home',            "appTab('home')",              [['.tb-feedtab-add',44,41],['.story-add',34,34]]],
 ['Services',        "acOpenServices()",            [['.svc-cat',44,44]]],
 ['Collections',     "acSetFeed('bookmarks')",      [['.ac-lchip',44,44]]],
 ['Write a post',    "acOpenPost()",                [['.ac-post-toolbar .msg-attach',44,44]]],
 ['Push notifications',"acGoSettingsPage('notifications')",[['.snz-chip',44,44]]],
 /* The icon-only controls — the half of this list the first pass missed entirely,
    because its check required a control to have TEXT. The two commonest controls in
    the app are here: the sheet close (90 screens) and the Settings back arrow (35). */
 ['Wallet',          "acOpenWallet()",              [['.sheet-close',44,44]]],
 ['Settings',        "acGoSettingsPage('account')", [['.iset-back',44,44]]],
 ['Home top bar',    "appTab('home')",              [['.tb-brand-act',44,44]]],
 ['Appearance',      "acGoSettingsPage('display')", [['.accent-sw',44,44]]],
 ['Marketplace',     "acOpenMarketplace()",         [['.mkt-cart',44,44]]],
 ['Edit profile',    "openProfileEdit()",           [['.pf-top-x',44,44],['.pf-cam',44,44],['.pf-bcam',44,44]]],
 /* SET THE SCOPE, don't just go home. An earlier case switches the feed to Collections
    and appTab('home') does not put the scope back — so this looked at an empty feed and
    reported a missing control over 24 real posts. */
 ['A post in the feed',"acSetFeed('foryou')",         [['.ac-post-more',44,44]]],
 ['Your profile',    "acGoProfile()",               [['.ac-icon-btn',44,44]]],
 ['Account',         "appTab('profile')",           [['.me-hero-switch',44,44]]],
 ['Businesses',      "acOpenDirectory()",           [['.dir-ind',44,44]]],
 /* B5 — the Help close. The first pass could not reach it and parked it, because the
    opener I looked for (acOpenHelp) does not exist; the real one is openHelp(). That was
    my error, not a dead route, so nothing needed hunting. */
 ['Help',            "openHelp()",                  [['.modal-x',44,44]]],
];
let pass=0,fail=0;
const ok=(c,n,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+n+(d?'  '+JSON.stringify(d):''));};
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
 const p=await b.newPage({viewport:{width:390,height:844}});
 await p.addInitScript(t=>localStorage.setItem('atwe_token',t),TOK);
 await p.goto('http://localhost:3262/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4200);
 for(const [screen,run,sels] of CASES){
  await p.evaluate(()=>{document.querySelectorAll('.overlay:not(.hidden)').forEach(o=>o.classList.add('hidden'));try{appTab('home')}catch(e){}});
  await p.waitForTimeout(320);
  try{ await p.evaluate(r=>{(0,eval)(r)},run); }catch(e){ ok(false,screen+' could not open',{e:e.message.slice(0,50)}); continue; }
  await p.waitForTimeout(1500);
  for(const [sel,minH,minW] of sels){
   const r=await p.evaluate(async([sel])=>{
     /* POLL, don't snapshot. A screen that fetches (the feed does) can be a frame or two
        behind a fixed wait, and "not found" then reports a fault on a control that is
        plainly there — .ac-post-more failed exactly that way over 24 real posts. */
     let el=null;
     for(let i=0;i<20;i++){
       el=[...document.querySelectorAll(sel)].find(e=>e.getBoundingClientRect().width>3);
       if(el) break; await new Promise(r=>setTimeout(r,150));
     }
     if(!el) return {missing:true};
     const b=el.getBoundingClientRect(), be=getComputedStyle(el,'::before');
     const n=v=>parseFloat(v)||0;
     const hit={w:b.width+ -n(be.left)+ -n(be.right), h:b.height+ -n(be.top)+ -n(be.bottom)};
     /* does the overlay reach over a sibling's centre? */
     let steals=null;
     const sib=el.nextElementSibling||el.previousElementSibling;
     if(sib){ const sb=sib.getBoundingClientRect();
       if(sb.width>3){ const hitEl=document.elementFromPoint(sb.x+sb.width/2, sb.y+sb.height/2);
         if(hitEl && (hitEl===el||el.contains(hitEl))) steals=String(sib.className).slice(0,24); } }
     return {w:Math.round(b.width),h:Math.round(b.height),
             hitW:Math.round(hit.w),hitH:Math.round(hit.h),steals,
             hasBefore: be.content!=='none'};
   },[sel]);
   if(r.missing){ ok(false, screen+' '+sel+' not found'); continue; }
   ok(r.hitH>=minH-0.5, screen+' '+sel+' hit height >= '+minH, r);
   ok(r.hitW>=minW-0.5, screen+' '+sel+' hit width >= '+minW, r);
   ok(!r.steals, screen+' '+sel+' does not steal its neighbour', {steals:r.steals});
  }
 }
 /* AND A SOURCE CHECK, because driving screens can only ever cover the controls those
    screens happen to hold — the block names nineteen classes and the reachable ones are
    a subset. That subset is exactly how this probe under-covered itself the first time.
    So: every class the 44pt block names must still be a real class somewhere in the app.
    A rename or a deletion orphans the overlay silently, and nothing else would say so. */
 const src=fs.readFileSync('/home/user/atwe/public/index.html','utf8');
 const blk=src.slice(src.indexOf('.sheet-close,.iset-back,.tb-brand-act'));
 const named=[...new Set((blk.slice(0,blk.indexOf('/* B2')).match(/\.[a-z][a-z0-9-]+(?=::before|[,{])/g)||[]))];
 ok(named.length>=19,'the 44pt block still names every control it was written for',{named:named.length});
 /* The test is deliberately blunt: does the BARE name appear anywhere OUTSIDE this block?
    A first attempt hunted for it inside class="..." and inside template literals, and it
    passed a deliberately renamed class — because a class attribute has no leading dot, so
    the pattern could never match, and the fallbacks matched by accident across the file.
    A check that cannot fail is worse than none. */
 const rest=src.replace(blk.slice(0,blk.indexOf('/* B2')),'');
 const orphans=named.filter(c=>!new RegExp('[^a-z0-9-]'+c.slice(1)+'(?![a-z0-9-])').test(rest));
 ok(orphans.length===0,'no class in the 44pt block has been renamed out from under it',{orphans});

 console.log('\n'+pass+' passed, '+fail+' FAILED');
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
