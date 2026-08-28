/* The login welcome moment: the mark rolls in see-through and dims away, the member's
   own photo zooms up through it at FULL colour. Samples the real computed state over
   time, then films it as a strip of frames. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto'), fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
// a tiny solid-red PNG so "full colour" is measurable in a screenshot
const RED='data:image/png;base64,'+Buffer.from(
 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64').toString('base64');
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local', pw='x'.repeat(12);
  const hash=await auth.hashPassword(pw);
  const h='wb'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,avatar) VALUES ('W',$1,$2,$3,true,true,$4)`,[email,hash,h,RED]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);

  // drive the real function with a real avatar
  const samples = await p.evaluate(async(av)=>{
    const out=[];
    playWelcomeSplash({avatar:av, name:'W'});
    const logo=document.querySelector('.wb-logo'), ava=document.querySelector('.wb-ava');
    const t0=performance.now();
    for(let i=0;i<26;i++){
      await new Promise(r=>setTimeout(r,90));
      const L=getComputedStyle(logo), A=getComputedStyle(ava);
      out.push({t:Math.round(performance.now()-t0),
        lo:+(+L.opacity).toFixed(2), lr:L.rotate, ls:L.scale,
        ao:+(+A.opacity).toFixed(2), as:A.scale});
    }
    return out;
  }, RED);
  const num=v=>parseFloat(String(v))||0;
  console.log('  t(ms)  logo-op  logo-rot  photo-op  photo-scale');
  samples.forEach(s=>console.log('  '+String(s.t).padStart(5)+'   '+String(s.lo).padStart(5)+'   '+String(s.lr).padStart(9)+'   '+String(s.ao).padStart(6)+'   '+s.as));

  const logoMax=Math.max(...samples.map(s=>s.lo));
  const avaMax =Math.max(...samples.map(s=>s.ao));
  ok(logoMax>0.15 && logoMax<0.45, 'the Atwe mark stays see-through', 'peak opacity '+logoMax);
  ok(avaMax>=0.99, 'the photo reaches FULL colour, not washed out', 'peak opacity '+avaMax);
  // it rolls: rotation must actually advance
  const rots=samples.map(s=>num(s.lr)).filter(v=>!Number.isNaN(v));
  ok(Math.max(...rots) > 180, 'the mark rolls a real turn, not a static fade', 'max rotation '+Math.max(...rots)+'deg');
  // it gets darker as it advances: opacity peaks then falls back to 0
  const peakAt=samples.findIndex(s=>s.lo===logoMax);
  const after=samples.slice(peakAt+1).map(s=>s.lo);
  ok(after.length>2 && Math.min(...after)<0.03, 'and dims away as it advances', JSON.stringify(after.slice(0,8)));
  // the photo zooms IN
  const scales=samples.map(s=>num(s.as)).filter(v=>v>0);
  ok(scales.length>2 && Math.min(...scales) < 0.9 && Math.max(...scales) >= 1,
     'the photo zooms in rather than appearing at its final size', 'scale '+Math.min(...scales)+' -> '+Math.max(...scales));
  ok(errs.length===0,'no JS errors',errs[0]);

  // film it
  await p.evaluate(av=>playWelcomeSplash({avatar:av,name:'W'}), RED);
  const shots=[];
  for (const at of [120,420,700,900,1150,1500,1900,2300]){
    await p.waitForTimeout(at - (shots.length?[120,420,700,900,1150,1500,1900,2300][shots.length-1]:0));
    const f=SP+'icons/WB-'+at+'.png';
    await p.screenshot({path:f, clip:{x:120,y:330,width:150,height:150}});
    shots.push(f);
  }
  console.log('  frames: '+shots.map(f=>f.split('/').pop()).join(' '));
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
