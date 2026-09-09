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
   const r=await p.evaluate(([sel])=>{
     const el=[...document.querySelectorAll(sel)].find(e=>e.getBoundingClientRect().width>3);
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
 console.log('\n'+pass+' passed, '+fail+' FAILED');
 await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
