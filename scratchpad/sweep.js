/* THE HONEST FULL PASS over the web app — step 1's definition.
   Opens every destination the app's own index knows about and asks a battery of
   OBJECTIVE questions of each. Objective is the point: this list has to be one a
   person can burn down, not a matter of taste. */
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'/node_modules/playwright-core');
const fs=require('fs');
const TOK=fs.readFileSync('/tmp/tok.txt','utf8').trim();
const DEST=JSON.parse(fs.readFileSync(SP+'destinations.json','utf8')).items;
const FROM=+(process.argv[2]||0), TO=+(process.argv[3]||DEST.length);
const THEME=process.argv[4]||'black';

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  const errs=[];
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
  p.on('pageerror',e=>errs.push('PAGEERROR '+String(e.message).slice(0,200)));
  await p.addInitScript(([t,th])=>{localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_theme',th);}, [TOK,THEME]);
  await p.goto('http://localhost:3262/',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4500);

  /* DESTINATIONS THAT END THE SESSION MUST NOT BE OPENED BY A SWEEP. The first run walked
     straight into "Log out" at index 119 and every one of the 34 settings rows after it
     reported THREW — 34 false findings from one real action. They are checked by hand
     instead (journeys.js drives sign-out for real). */
  const DESTRUCTIVE=/^(Log out|Delete account)$/;
  const out=[];
  for(let i=FROM;i<TO;i++){
    const d=DEST[i];
    if(DESTRUCTIVE.test(d.name)){ console.log(String(i).padStart(3),'  '+d.name.padEnd(30).slice(0,30),'skipped — ends the session'); continue; }
    errs.length=0;
    /* SOME DESTINATIONS LEAVE THE APP ENTIRELY, and one of them poisoned 34 results.
       `openAdmin()` navigates to the admin dashboard, so every settings row after it ran
       against admin.html and reported "acGoSettingsPage is not defined" — 34 findings from
       one real navigation. Rather than keep a list of which ones do it (the next one would
       be missed the same way), ask the page whether the app is still there and boot it back
       if not. Generic, so it covers whatever navigates away next. */
    const alive = await p.evaluate(()=>typeof appTab==='function').catch(()=>false);
    if(!alive){
      await p.goto('http://localhost:3262/',{waitUntil:'domcontentloaded'});
      await p.waitForTimeout(4500);
      console.log('    (app had been navigated away — booted it back)');
    }
    /* Back to a known state WITHOUT walking history (closeOverlay would). */
    await p.evaluate(()=>{
      document.querySelectorAll('.overlay:not(.hidden)').forEach(o=>{o.classList.add('hidden');});
      document.body.className=document.body.className.replace(/\bnotif-tab\b|\bsb-open\b/g,'');
      try{ appTab('home'); }catch(e){}
    });
    await p.waitForTimeout(350);
    const before=await p.evaluate(()=>document.body.innerText.length);

    let threw=null;
    try{ await p.evaluate(r=>{ (0,eval)(r); }, d.run); }
    catch(e){ threw=String(e.message).slice(0,160); }
    await p.waitForTimeout(1400);

    const r=await p.evaluate(([name,before])=>{
      const vw=innerWidth;
      /* what is actually on top and on screen */
      const ov=[...document.querySelectorAll('.overlay:not(.hidden)')].pop();
      const scope = ov || document.querySelector('#app') || document.body;
      const txt=(scope.innerText||'').trim();

      /* 1. CAN THE MEMBER ACTUALLY SCROLL SIDEWAYS? — the honest question, and one
         number instead of a list of suspects. The first version walked every element
         and reported anything sticking out; it flagged the off-canvas mobile DRAWER
         (deliberately parked off-screen), the parked notification detail page and a
         decorative glow on every single surface — noise on correct code, which is
         worse than no check. What a person experiences is the page sliding sideways,
         so measure exactly that, on the page and on whichever scroller is on screen. */
      const scrollers=[document.scrollingElement, ...scope.querySelectorAll('*')]
        .filter(el=>{ if(!el) return false;
          if(el===document.scrollingElement) return true;
          const b=el.getBoundingClientRect();
          if(b.width<200||b.height<200) return false;
          const cs=getComputedStyle(el);
          return cs.overflowX==='auto'||cs.overflowX==='scroll'||cs.overflow==='auto'; });
      const wide=[];
      for(const el of scrollers){
        const over=el.scrollWidth-el.clientWidth;
        if(over>2){
          const cs=getComputedStyle(el);
          /* a carousel is MEANT to pan sideways — only a surface-level scroller counts */
          if(el!==document.scrollingElement && cs.overflowY==='hidden') continue;
          wide.push(((el.id||el.className||el.tagName)+'').slice(0,32)+' +'+over+'px');
        }
      }

      /* 2. text CLIPPED with no ellipsis — words a member simply cannot read */
      const clipped=[];
      scope.querySelectorAll('*').forEach(el=>{
        if(el.children.length) return;
        const t=(el.textContent||'').trim(); if(t.length<3) return;
        const cs=getComputedStyle(el);
        if(cs.overflow!=='hidden'&&cs.overflowX!=='hidden'&&cs.overflowY!=='hidden') return;
        if(cs.textOverflow==='ellipsis') return;
        if(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2) clipped.push(t.slice(0,50));
      });

      /* 3. more than one WHITE primary action on one screen (the colour law) */
      const prim=getComputedStyle(document.body).getPropertyValue('--primary').trim();
      const whites=[...scope.querySelectorAll('button,a,[role=button]')].filter(el=>{
        const b=el.getBoundingClientRect(); if(b.width<24||b.height<16) return false;
        if(!el.offsetParent && getComputedStyle(el).position!=='fixed') return false;
        const bg=getComputedStyle(el).backgroundColor;
        if(!/^rgb/.test(bg)) return false;
        const m=bg.match(/[\d.]+/g); if(!m||(m[3]!==undefined&&+m[3]<0.5)) return false;
        const [R,G,B]=m.map(Number);
        const lum=(0.2126*R+0.7152*G+0.0722*B)/255;
        const grey=Math.max(R,G,B)-Math.min(R,G,B)<12;
        if(!(grey && lum>0.75 && !!el.onclick)) return false;
        /* A SELECTED TAB IS WHITE AND IS NOT AN ACTION — the colour law's own carve-out
           ("white here is a STATE, not an action"). Identify one STRUCTURALLY, the way
           emptystates.js does, rather than by class name: it is one of several
           same-shaped siblings. Without this, every tab row on every surface reported a
           second white primary — the check fired on Home, Beam and Engine at once, which
           is the giveaway that it was wrong rather than the app. */
        const base=(String(el.className).split(' ')[0])||'';
        const sibs=[...(el.parentElement?el.parentElement.children:[])]
          .filter(x=>x.tagName===el.tagName && String(x.className).split(' ')[0]===base);
        if(sibs.length>=2) return false;   // a tab row; the SELECTED one carries an extra class
        return true;
      }).map(el=>({t:(el.innerText||'').trim().slice(0,24), fn:String(el.getAttribute('onclick')||'').slice(0,60)}))
        .filter(x=>x.t);
      /* WHAT IS ACTUALLY A FAULT is a DUPLICATE — two white pills doing the SAME job on one
         screen, which is the thing emptystates.js already found nine of (a header's create
         button beside an empty state's "Add a listing"). A plain COUNT of white pills is not
         a fault and reported one on every browse surface: a list of cards each carrying its
         own Buy now is deliberate, and so is a selected tab. Count for information; fail
         only on a genuine duplicate. */
      const seen={}, dupWhite=[];
      for(const w of whites){ const k=(w.fn||w.t).toLowerCase();
        if(seen[k]) dupWhite.push(w.t); else seen[k]=1; }

      return { name, top: ov?ov.id:'(no overlay)', chars: txt.length, grew: txt.length!==before,
        wide:[...new Set(wide)].slice(0,4), clipped:[...new Set(clipped)].slice(0,4),
        whites:whites.map(w=>w.t), dupWhite:[...new Set(dupWhite)],
        /* A FAILURE MESSAGE IS A WHOLE LINE, not a substring. Matching anywhere flagged
           Help & refunds on its own explanatory copy — "Charged by mistake or something
           went wrong? Pick the payment…" — which is a good sentence, not a fault. */
        fail: txt.split('\n').some(l=>/^\s*(Could not load|Something went wrong|Couldn.t load|Failed to load|Nothing to show)\.?\s*$/i.test(l)),

        /* RENDERED RUBBISH — a value that leaked to the screen as a word. Zero-noise and
           the highest-signal thing on this list: no copy anywhere says "undefined". */
        junk: [...new Set((txt.match(/\b(undefined|NaN|\[object Object\]|Infinity)\b/g)||[]))],

        /* TEXT A MEMBER CANNOT READ — real contrast against the real background behind it.
           4.5:1 is the floor for normal text, 3:1 once it is large (18.66px bold / 24px). */
        dim: (()=>{
          const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});
            return .2126*r+.7152*g+.0722*b;};
          const px=c=>{const m=String(c).match(/[\d.]+/g); return m?m.slice(0,3).map(Number):null;};
          /* A GRADIENT CANNOT BE READ OUT OF CSS, and pretending otherwise invents faults.
             The wallet card, the Engine AI hero, Atwe Card, Rewards, Affiliate and Your
             studio all paint a background-IMAGE; their background-COLOR is transparent, so
             walking up for a colour sails past the card to the page behind it. In Light
             that is white, the text on the card is white, and the ratio comes out exactly
             1.00:1 — which is the giveaway: it reported "Balance", "$0.00", "Send" and
             "Coming soon" as invisible on six screens where they are plainly legible.
             Return null for these and count them, rather than scoring them wrong. */
          const bgOf=el=>{ let n=el;
            while(n&&n!==document.documentElement){ const cs2=getComputedStyle(n);
              if(cs2.backgroundImage&&cs2.backgroundImage!=='none') return null;   // gradient/photo
              const c=cs2.backgroundColor;
              const m=String(c).match(/[\d.]+/g);
              if(m&&(m[3]===undefined||+m[3]>0.85)) return px(c); n=n.parentElement; }
            return px(getComputedStyle(document.body).backgroundColor)||[0,0,0]; };
          let onGradient=0;
          const out=[];
          scope.querySelectorAll('*').forEach(el=>{
            if(el.children.length) return;
            const t=(el.textContent||'').trim(); if(t.length<4) return;
            const b=el.getBoundingClientRect();
            /* MEASURE TEXT BELOW THE FOLD TOO. The first version required the text to be
               inside the viewport, which on a scrolling surface meant most of it was never
               looked at — the settings subtitles, for one, sit below the fold on every
               page. A rendered element has correct computed colours wherever it sits, and
               the genuinely hidden things (display:none, visibility, opacity) are already
               filtered below, so the viewport test bought nothing and cost the coverage. */
            if(b.width<8||b.height<6) return;
            const cs=getComputedStyle(el);
            if(cs.visibility==='hidden'||+cs.opacity<0.6) return;
            const fg=px(cs.color); if(!fg) return;
            const bg=bgOf(el); if(!bg){ onGradient++; return; }
            const L1=lum(fg), L2=lum(bg);
            const ratio=(Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
            const size=parseFloat(cs.fontSize)||14, bold=(+cs.fontWeight||400)>=700;
            const floor=(size>=24||(size>=18.66&&bold))?3:4.5;
            if(ratio<floor-0.05) out.push(t.slice(0,28)+' ['+ratio.toFixed(2)+':1 @'+Math.round(size)+'px]');
          });
          out.gradientSkipped=onGradient;
          return [...new Set(out)].slice(0,6);
        })(),

        /* A CONTROL TOO SMALL TO HIT — 44pt is the floor, and an invisible ::before overlay
           can legitimately supply it, so measure the TARGET the browser would hit. */
        small: (()=>{
          const out=[];
          scope.querySelectorAll('button,[role=button],a[onclick]').forEach(el=>{
            const t=(el.innerText||'').trim(); if(!t||t.length>26) return;
            const b=el.getBoundingClientRect();
            if(b.width<4||b.height<4||b.top>innerHeight||b.bottom<0) return;
            const be=getComputedStyle(el,'::before');
            let h=b.height, w=b.width;
            if(be && be.content!=='none' && be.position==='absolute'){
              const ins=['top','bottom','left','right'].map(k=>parseFloat(be[k])||0);
              h+= -(ins[0])-(ins[1]); w+= -(ins[2])-(ins[3]);
            }
            if(h<44-0.5 && w<44-0.5) out.push(t+' ['+Math.round(w)+'x'+Math.round(h)+']');
          });
          return [...new Set(out)].slice(0,6);
        })(),
        head: txt.slice(0,60).replace(/\n/g,' | ') };
    }, [d.name, before]);

    r.sub=d.sub; r.run=d.run; r.threw=threw; r.errs=[...new Set(errs)].slice(0,3);
    out.push(r);
    const bad=[threw&&'THREW', r.fail&&'FAIL-TEXT', r.wide.length&&'WIDE', r.clipped.length&&'CLIPPED', r.junk.length&&'JUNK-TEXT', r.dim.length&&'LOW-CONTRAST', r.small.length&&'SMALL-TARGET',
               r.dupWhite.length&&'DUP-WHITE', r.errs.length&&'JSERR', (!r.grew&&r.top==='(no overlay)')&&'NO-OPEN'].filter(Boolean);
    console.log(String(i).padStart(3), (bad.length?'⚠ ':'  ')+d.name.padEnd(30).slice(0,30), (bad.join(',')||'ok'));
  }
  fs.writeFileSync(SP+`sweep-${THEME}-${FROM}-${TO}.json`, JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
