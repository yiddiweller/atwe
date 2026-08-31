/* Demo mode must never show a BROKEN picture. It did: portraits and monogram logos
   rendered while every post/banner/story photo was an empty box, because one of the free
   placeholder hosts was not answering. Those hosts make no uptime promise, so the fix is
   not to swap one for another — any upstream failure now falls through to an image the
   server generates itself.
   Two things are asserted, and the second is the one that bit: it must also be FAST. The
   upstream timeout was 8 seconds, so with a host that hangs rather than refusing, every
   picture on the screen sat blank for eight seconds before the fallback could draw. */
const SP=__dirname+'/';
const {chromium}=require(SP+'node_modules/playwright-core');
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  const r=await p.evaluate(async()=>{
    const mk=(u)=>new Promise(res=>{const t0=performance.now(); const i=new Image();
      i.onload=()=>res({ok:i.naturalWidth>0,w:i.naturalWidth,h:i.naturalHeight,ms:Math.round(performance.now()-t0)});
      i.onerror=()=>res({ok:false,ms:Math.round(performance.now()-t0)});
      i.src='/api/demo-media?u='+encodeURIComponent(u);});
    const post   = await mk('https://picsum.photos/seed/atwe-post-9/900/650');
    const banner = await mk('https://picsum.photos/seed/atwe-bn-3/900/300');
    const face   = await mk('https://randomuser.me/api/portraits/men/7.jpg');
    const same   = await mk('https://picsum.photos/seed/atwe-post-9/900/650');
    const batch  = await Promise.all([1,2,3,4,5,6,7,8].map(n=>mk('https://picsum.photos/seed/atwe-post-'+n+'/900/650')));
    const evil   = await mk('https://example.com/not-allowed.jpg');
    return {post,banner,face,same,slowest:Math.max(...batch.map(x=>x.ms)),allOk:batch.every(x=>x.ok),evilOk:evil.ok};
  });
  ok(r.post.ok,   'a demo POST picture renders',   r.post.w+'x'+r.post.h+' in '+r.post.ms+'ms');
  ok(r.banner.ok, 'a demo BANNER renders',         r.banner.w+'x'+r.banner.h);
  ok(r.face.ok,   'a demo PORTRAIT renders',       r.face.w+'x'+r.face.h);
  /* the picture must match the shape the layout asked for, or the feed jumps as it lands */
  ok(r.post.w===900 && r.post.h===650, 'it comes back at the size the page asked for', r.post.w+'x'+r.post.h);
  ok(r.banner.w===900 && r.banner.h===300, 'a banner keeps its own shape too', r.banner.w+'x'+r.banner.h);
  ok(r.allOk, 'eight at once all render', 'slowest '+r.slowest+'ms');
  ok(r.slowest < 2500, 'and none of them makes the screen wait', 'slowest '+r.slowest+'ms');
  /* the fallback must not become an open proxy: only the allowlisted hosts are fetched,
     and anything else is still refused rather than quietly answered with a picture */
  ok(!r.evilOk, 'a host that is not on the allowlist is still refused');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
