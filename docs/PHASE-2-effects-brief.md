# PHASE 2 BRIEF FOR CLAUDE CODE — EFFECTS & LIGHTING (FINAL · LOCKED)

Read this entire document before writing any code. This is PHASE 2 of 2. Phase 1 (the color repaint to black/white/blue + grey) is already complete and approved — all tokens referenced below (--bg, --card, --elev, --divider, --ink, --ink-2, --ink-3, --text-black, --blue, --blue-tint, semantic families, --ease) already exist in the codebase. In this phase you add the LIGHTING AND ANIMATION SYSTEM on top of those colors. Do not change any Phase 1 colors, layouts, or components beyond what this brief specifies. Every value was approved from a working prototype — use them exactly.

## 0. THE LAWS (read twice)

LAW 1 — RESPECT PHASE 1. The black/white/blue + grey palette is locked and applied. All light in this phase uses ONLY the light family defined below (white → icy → electric blue → indigo). No new colors. The red comet palette appears only in the AI error state.

LAW 2 — LIGHT, NOT COLOR. The site is a dark room. Nothing has visible borders at rest — boxes are dark shapes in blackness. Light appears only from: (a) the user's mouse movement, (b) the opening-lap intro on page load, (c) AI operations. Scrolling the page does NOTHING to the lighting.

LAW 3 — AI EXCLUSIVITY. The orbiting comet bubbles are reserved for AI operations only (generate, search, summarize, rewrite — any AI call). They never appear on hover, on load, or for non-AI loading. Scope matches the job: an answer in a box → comets orbit that box only; a whole-page/whole-chat job → comets orbit the entire screen.

LAW 4 — EVERY PAGE. Layers A–D and the opening-lap intro run on EVERY page and screen, including login and signup, from the first paint. Logging in must feel like the rest of the site: black screen, opening lap around the auth card, mouse-driven light after.

---

## 1. NEW TOKENS FOR THIS PHASE (add alongside the Phase 1 tokens)

```css
:root{
  /* THE LIGHT — white → icy → electric blue → indigo → black */
  --light-core:#FFFFFF;
  --light-fringe:#DBE9FF;              /* icy edge of the white line   */
  --light-mid:rgb(120,160,255);
  --light-blue:rgb(56,86,255);         /* electric halo                */
  --light-deep:rgb(26,38,220);         /* indigo falloff               */
  --pool-hi:rgb(24,32,175);            /* dark indigo mouse-pool       */
  --pool-lo:rgb(12,14,120);

  --boost:0;               /* movement energy 0–1 (JS)                 */
  --rim:0;                 /* light energy 0–1, slow melt (JS)         */
}
```

## 2. BUTTON LIGHT (upgrade the Phase 1 buttons — fills/hairlines/states stay as-is)

Every button gets `data-glow` plus a subtle movement flare in ITS OWN color (blue flares blue, green green, red red, yellow yellow, grey flares blue) via a boost-driven outer shadow and a cursor-anchored wash. These replace/extend the Phase 1 button rules with the versions below (identical fills and hairlines; only the light additions differ). The blue button still has NO edge:

```css
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  border:0;cursor:pointer;border-radius:999px;padding:13px 26px;
  font:600 15px/1 Inter,sans-serif;letter-spacing:-.01em;
  position:relative;overflow:hidden;
  transition:transform .3s var(--ease),filter .25s var(--ease),box-shadow .3s var(--ease)}
.btn:hover{filter:brightness(1.05);transform:translateY(-1px)}
.btn:active{filter:brightness(.85);transform:scale(.97)}
.btn[disabled]{background:var(--elev);color:var(--ink-2);box-shadow:none;
  opacity:.4;pointer-events:none}

.btn-blue{background:var(--blue);color:var(--blue-tint);   /* NO edge */
  box-shadow:0 0 calc(14px*var(--boost)) -6px rgba(52,82,255,.4)}
.btn-blue::after{content:"";position:absolute;inset:0;border-radius:inherit;
  background:radial-gradient(100px 76px at var(--mx,50%) var(--my,120%),
    rgba(150,182,255,.6),rgba(219,233,255,.32) 40%,transparent 72%);
  opacity:calc(.16 + .22*var(--boost));transition:opacity .3s var(--ease)}
.btn-blue:hover::after{opacity:1}

.btn-grey{color:var(--ink);
  background:
    radial-gradient(120px 86px at var(--mx,50%) var(--my,120%),
      rgba(52,82,255,calc(.10 + .14*var(--boost))),transparent 72%),
    rgba(255,255,255,.06);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  box-shadow:0 0 0 .5px var(--divider) inset,
    0 0 calc(12px*var(--boost)) -6px rgba(52,82,255,.32)}

.btn-green{background:var(--green);color:var(--green-tint);
  box-shadow:0 0 0 .5px var(--green-edge) inset,
    0 0 calc(13px*var(--boost)) -6px rgba(48,209,88,.38)}
.btn-red{background:var(--red);color:var(--red-tint);
  box-shadow:0 0 0 .5px var(--red-edge) inset,
    0 0 calc(13px*var(--boost)) -6px rgba(255,69,58,.38)}
.btn-yellow{background:var(--yellow);color:var(--text-black);
  box-shadow:0 0 0 .5px var(--yellow-edge) inset,
    0 0 calc(13px*var(--boost)) -6px rgba(255,204,0,.33)}
```

Inputs (upgrade Phase 1): add the cursor wash `rgba(52,82,255,calc(.06 + .08*var(--boost)))` over --elev, and on focus add the glow `box-shadow:0 0 26px -8px rgba(52,82,255,.6)` alongside the --blue border.

---

## 3. LAYER A — The black stage (every page, root layout)

Pure black. A barely-there grid. NO constant haze — the only background light is the pool that follows the mouse (Layer B/C drive it). Mount once:

```css
.stage{position:fixed;inset:0;pointer-events:none;z-index:0}
.stage::before{content:"";position:absolute;inset:0;   /* mouse pool */
  background:radial-gradient(340px circle at var(--pgx,50%) var(--pgy,-20%),
    rgba(24,32,175,calc(.11*var(--rim,0))) 0%,
    rgba(12,14,120,calc(.045*var(--rim,0))) 45%,transparent 72%);
  filter:blur(10px) saturate(1.35)}
.stage::after{content:"";position:absolute;inset:0;    /* faint grid  */
  background-image:
    linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px);
  background-size:56px 56px;
  -webkit-mask-image:radial-gradient(70% 55% at 50% 0%,#000 20%,transparent 100%);
          mask-image:radial-gradient(70% 55% at 50% 0%,#000 20%,transparent 100%)}
```

All page content sits above it (`position:relative;z-index:1`).

---

## 4. LAYERS B+C — The lightbulb (the signature; every page)

MODEL: the user's cursor is a lightbulb. A soft dark-indigo pool glows in the background under it; the nearest edges of every major box burn white-to-electric-blue where the bulb is close, like a filament — one single thick line (2.5px) with its glow, never two lines, never a visible border at rest. The light melts away over ~3.5s when the mouse stops. Scrolling does nothing. Mark major boxes (hero panels, auth cards, feature cards, key containers — NOT tiny chips or list rows) with class `spin`; interactive elements with `data-glow`.

```css
.spin{position:relative}
/* ONE line: sharp layer + identical blurred twin at the SAME geometry */
.spin::before,.spin::after{
  content:"";position:absolute;inset:0;border-radius:inherit;
  padding:2.5px;pointer-events:none;
  background:radial-gradient(var(--gr,260px) circle at var(--gx,50%) var(--gy,-40%),
    #ffffff 0%,
    #dbe9ff 9%,
    rgba(120,160,255,1) 22%,
    rgba(56,86,255,.95) 40%,
    rgba(26,38,220,.55) 62%,
    transparent 80%);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
  opacity:calc(1.2*var(--rim,0));
  filter:drop-shadow(0 0 3px rgba(255,255,255,.95))
         drop-shadow(0 0 10px rgba(96,130,255,.95))
         drop-shadow(0 0 26px rgba(46,76,255,.85));
  transition:opacity 1s cubic-bezier(.25,.6,.3,1);
}
.spin::after{filter:blur(10px) saturate(1.35);
  opacity:calc(1.3*var(--rim,0));
  transition:opacity 1s cubic-bezier(.25,.6,.3,1)}
/* outer flood into the darkness — dim, tight (approved balance) */
.rim-flood{
  position:absolute;inset:-22px;border-radius:inherit;
  pointer-events:none;z-index:-1;
  background:radial-gradient(calc(var(--gr,260px)*1.15) circle at var(--gx,50%) var(--gy,-40%),
    rgba(198,214,255,.95) 0%,
    rgba(56,86,255,.85) 34%,
    rgba(22,34,215,.45) 58%,
    transparent 78%);
  filter:blur(42px) saturate(1.3);
  opacity:calc(.35*var(--rim,0));
  transition:opacity 1.2s cubic-bezier(.25,.6,.3,1);
}
/* faint interior spill, clipped inside the box */
.rim-clip{position:absolute;inset:0;border-radius:inherit;
  overflow:hidden;pointer-events:none}
.rim-inner{
  position:absolute;inset:-8px;border-radius:inherit;
  background:radial-gradient(calc(var(--gr,260px)*.9) circle at var(--gx,50%) var(--gy,-40%),
    rgba(150,182,255,.8) 0%,
    rgba(56,86,255,.55) 38%,
    rgba(18,28,195,.28) 60%,
    transparent 78%);
  filter:blur(24px) saturate(1.25);
  opacity:calc(.12*var(--rim,0));
  transition:opacity 1.2s cubic-bezier(.25,.6,.3,1);
}
```

Cards keep a whisper of interior life: background wash `rgba(52,82,255,calc(.035 + .025*var(--boost)))` over --card, and `filter:brightness(calc(1 + .025*var(--boost)))`. The BODY of boxes must stay dark — the approved balance is a blazing line on a dark quiet body; do not raise the flood/inner values.

CRITICAL CSS BUG TO AVOID: do NOT register --gx/--gy/--rim/--boost via `@property` with `inherits:false` — that blocks the values from reaching pseudo-elements/children and freezes the light. Plain (unregistered) custom properties only.

---

## 5. THE ENGINE (one root client component; complete code)

Runs everywhere. Handles: cursor tracking, energy, the melt, the bulb glide, the opening-lap intro, and layer injection. In Next.js put this in a client component mounted in the root layout; re-run collection on route change (or MutationObserver for dynamic nodes). All listeners passive; per-frame work in one rAF loop.

```js
/* ---- collect ---- */
const glows=[...document.querySelectorAll('[data-glow],.card')];
const spins=[...document.querySelectorAll('.spin')];
let px=innerWidth/2,py=0,rafB=null;
let boost=0,rim=0;
function bump(v){boost=Math.min(1,boost+v)}

/* ---- inject flood + clipped inner wash into every .spin ---- */
for(const el of spins){
  const fl=document.createElement('span');fl.className='rim-flood';el.prepend(fl);
  const clip=document.createElement('span');clip.className='rim-clip';
  const inn=document.createElement('span');inn.className='rim-inner';
  clip.appendChild(inn);el.appendChild(clip);
  const set=()=>el.style.setProperty('--gr',
    Math.max(200,Math.min(460,el.offsetWidth*.55))+'px');
  set();new ResizeObserver(set).observe(el);
}

/* ---- cursor tracking (Layer B) ---- */
function paintB(){rafB=null;
  for(const el of glows){const r=el.getBoundingClientRect();
    el.style.setProperty('--mx',(px-r.left)+'px');
    el.style.setProperty('--my',(py-r.top)+'px');}}
addEventListener('pointermove',e=>{px=e.clientX;py=e.clientY;
  if(!rafB)rafB=requestAnimationFrame(paintB);
  const mag=Math.hypot(e.movementX||0,e.movementY||0);
  bump(mag*.004);                 /* buttons breathe            */
  rim=Math.min(1,rim+mag*.004);   /* the light charges          */
},{passive:true});
/* touch = movement */
addEventListener('touchmove',()=>{bump(.03);rim=Math.min(1,rim+.03);},{passive:true});
/* SCROLL DOES NOTHING — do not add scroll listeners for light  */

/* mobile idle drift so surfaces stay alive without a cursor */
if(matchMedia('(hover: none)').matches){
  let t=0;(function idle(){t+=.006;
    px=innerWidth*(.5+Math.cos(t*1.2)*.35);
    py=innerHeight*(.45+Math.sin(t)*.3);
    if(!rafB)rafB=requestAnimationFrame(paintB);
    requestAnimationFrame(idle);})();
}

/* ---- OPENING LAP (every page load, incl. login) ----
   the light auto-runs ~2.5 decelerating laps around every box,
   staggered per box, ~3.6s, then hands off to the mouse.       */
const INTRO_MS=3600, INTRO_LAPS=2.5, introStart=performance.now();
function perimeterPoint(el,u){
  const w=el.offsetWidth,h=el.offsetHeight,per=2*(w+h);
  let d=((u%1)+1)%1*per;
  if(d<w)   return [d,0];
  d-=w; if(d<h) return [w,d];
  d-=h; if(d<w) return [w-d,h];
  d-=w;         return [0,h-d];
}

/* ---- the loop: energy melt + bulb glide + intro ---- */
let gx=innerWidth/2,gy=0;
(function loop(){
  const t=performance.now()-introStart, intro=t<INTRO_MS;
  if(intro){
    const k=t/INTRO_MS, ease=1-Math.pow(1-k,3);  /* fast start, soft stop */
    rim=Math.max(rim,1-k*.2);
    let i=0;
    for(const el of spins){
      const [ix,iy]=perimeterPoint(el,ease*INTRO_LAPS + i*.33);
      el.style.setProperty('--gx',ix+'px');
      el.style.setProperty('--gy',iy+'px');i++;
    }
  }
  boost=Math.max(0,boost-.02);       /* buttons settle fast     */
  rim  =Math.max(0,rim-.0045);       /* light melts ~3.5s       */
  document.documentElement.style.setProperty('--boost',boost.toFixed(3));
  document.documentElement.style.setProperty('--rim',rim.toFixed(3));
  gx+=(px-gx)*.18; gy+=(py-gy)*.18;  /* bulb glides smoothly    */
  document.documentElement.style.setProperty('--pgx',gx+'px');
  document.documentElement.style.setProperty('--pgy',gy+'px');
  if(!intro)for(const el of spins){
    const r=el.getBoundingClientRect();
    el.style.setProperty('--gx',(gx-r.left)+'px');
    el.style.setProperty('--gy',(gy-r.top)+'px');
  }
  requestAnimationFrame(loop);
})();
```

Reveal-by-light for sections entering the viewport (keep — it's part of the approved feel):

```css
[data-reveal]{opacity:0;transform:translateY(16px);filter:brightness(.55);
  transition:opacity .7s var(--ease),transform .7s var(--ease),filter .7s var(--ease)}
[data-reveal].lit-in{opacity:1;transform:none;filter:brightness(1)}
```
```js
const io=new IntersectionObserver(es=>{es.forEach((e,i)=>{
  if(e.isIntersecting){setTimeout(()=>e.target.classList.add('lit-in'),i*80);
    io.unobserve(e.target);}});},{threshold:.15});
document.querySelectorAll('[data-reveal]').forEach(el=>io.observe(el));
```

---

## 6. LAYER E — AI comets (AI ONLY; two scopes)

Electric-blue orbs with fading comet tails orbiting the working element, behind its surface. Colors follow the light family: core white → #DBE9FF → rgba(52,102,255,.6); halo rgba(150,182,255,.85) → rgba(52,82,255,.5); tails rgba(140,175,255,.6) → rgba(18,60,230,.3).

STATES: THINKING (~160px/s along the border) → STREAMING (×1.5 speed) → SUCCESS (final lap at ×2 brightening, then 600ms → fade → full DOM removal at 700ms) → ERROR (red family #FF453A/#FF6B60 single 900ms pulse, then fade). Set aria-busy during thinking/streaming.

SCOPES (approved rule — scope of the job = scope of the light):
1. BOX SCOPE: normal answers/generations → `aiGlow.start(resultEl)` on the prompt box, result panel, or search bar doing the work. Nothing else glows.
2. PAGE SCOPE: whole-page/whole-chat jobs (summarize the page, summarize the chat, act on everything) → a fixed invisible frame `#page-glow{position:fixed;inset:10px;border-radius:26px;pointer-events:none;z-index:60;isolation:isolate}` mounted in the root layout with `#page-glow .ai-orb{z-index:0}`, started with `aiGlow.start(pageGlowEl,{speed:1100,twin:true,size:70})` — two comets, opposite phases, fast around the whole screen.

```css
.ai-glow-host{position:relative;isolation:isolate}
.ai-orb{position:absolute;top:0;left:0;border-radius:50%;pointer-events:none;
  z-index:-1;offset-rotate:0deg;
  animation:ai-travel var(--dur,4s) linear infinite;animation-delay:var(--del,0s);
  transition:opacity .35s var(--ease);will-change:offset-distance}
@keyframes ai-travel{to{offset-distance:100%}}
.ai-orb.core{background:radial-gradient(closest-side,#fff,#DBE9FF 35%,
  rgba(52,102,255,.6) 65%,transparent);filter:blur(1.5px)}
.ai-orb.halo{background:radial-gradient(closest-side,rgba(150,182,255,.85),
  rgba(52,82,255,.5) 45%,transparent 72%);filter:blur(10px)}
.ai-orb.tail{background:radial-gradient(closest-side,rgba(140,175,255,.6),
  rgba(18,60,230,.3) 50%,transparent 72%);filter:blur(7px)}
[data-ai-fading] .ai-orb{opacity:0}
```

```ts
// lib/aiGlow.ts — zero dependencies
const SPEC:[string,number,number][]=[['halo',1.9,0],['core',.55,0],
  ['tail',.9,-.05],['tail',.7,-.10],['tail',.5,-.16]];
function pathFor(w:number,h:number,r:number){r=Math.min(r,w/2,h/2);
  return `M ${r},0 H ${w-r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h-r} A ${r} ${r} 0 0 1 ${w-r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h-r} V ${r} A ${r} ${r} 0 0 1 ${r},0 Z`}
function unmount(el:HTMLElement){el.querySelectorAll('.ai-orb').forEach(o=>o.remove());
  el.classList.remove('ai-glow-host');el.removeAttribute('data-ai-fading');
  el.removeAttribute('aria-busy');}
export const aiGlow={
  start(el:HTMLElement,opts:{speed?:number,twin?:boolean,size?:number}={}){
    unmount(el);el.classList.add('ai-glow-host');el.setAttribute('aria-busy','true');
    const speed=opts.speed||160,twin=!!opts.twin,size=opts.size||null;
    const w=el.offsetWidth,h=el.offsetHeight;
    const rad=parseFloat(getComputedStyle(el).borderTopLeftRadius)||0;
    const p=pathFor(w,h,rad),dur=(2*(w+h))/speed;
    const sets=twin?[0,-dur/2]:[0];
    for(const off of sets)for(const[cls,k,d]of SPEC){
      const o=document.createElement('span');o.className='ai-orb '+cls;
      const s=Math.max(14,(size||h)*k*0.5+24);
      o.style.width=o.style.height=s+'px';
      o.style.marginLeft=o.style.marginTop=(-s/2)+'px';
      o.style.offsetPath=`path('${p}')`;
      o.style.setProperty('--dur',dur+'s');
      o.style.setProperty('--del',(d*dur+off)+'s');
      if(cls==='tail')o.style.opacity=String(.75+d*3);
      el.prepend(o);}},
  speed(el:HTMLElement,f:number){el.querySelectorAll<HTMLElement>('.ai-orb').forEach(o=>{
    const d=parseFloat(o.style.getPropertyValue('--dur'));
    o.style.setProperty('--dur',(d/f)+'s');});},
  stream(el:HTMLElement){this.speed(el,1.5)},
  success(el:HTMLElement){this.speed(el,2);
    setTimeout(()=>{el.setAttribute('data-ai-fading','');
      setTimeout(()=>unmount(el),700);},600);},
  error(el:HTMLElement){/* swap orbs to red palette */ 
    setTimeout(()=>{el.setAttribute('data-ai-fading','');
      setTimeout(()=>unmount(el),700);},900);},
  stop(el:HTMLElement){unmount(el)},
};
```

Also provide `hooks/useAiGlow.ts` returning `{ref,glow}` with cleanup on unmount. WIRING: find every AI request in my codebase (fetch/SDK calls to AI endpoints, streaming handlers). Instrument the shared AI client if one exists, otherwise each call site: start() on request begin (box scope by default; page scope when the operation targets the whole page/chat), stream() on first chunk, success() on completion, error() on catch/timeout. Max 2 simultaneous AI glows; skip a third. PRESENT ME THE LIST of AI entry points you found and which scope you assigned each, BEFORE wiring. Fallback if offset-path is unsupported: a fast bright rotating conic ring in the comet palette (distinct from the bulb light). Never ship nothing.

---

## 7. LOGIN & SIGNUP

Full system from first paint: pure black, the auth card is a `.spin` box, the opening lap runs around it on load (~2.5 laps, decelerating, then melts), inputs use the --elev/wash/focus recipe, primary button is .btn-blue with no outline, `data-reveal` on the card. No AI comets here unless an AI feature actually runs.

---

## 8. HARD RULES

1. Colors: no new colors beyond the Phase 1 tokens plus the light family in Section 1 of this brief. The red comet palette appears only in the AI error state.
2. No visible borders on boxes at rest — no outlines, no rings, nothing. The light IS the only edge, and only while rim > 0.
3. Blue primary button has NO edge/outline. Semantic buttons keep the 0.5px hairline. Yellow text is --text-black, never a pale tint.
4. Scroll must not light anything. Only mouse/touch movement, the opening lap, and AI do.
5. AI comets only during AI operations; box scope vs page scope per the rule; always cleaned up (no detached nodes after 50 cycles).
6. Animate only transform, opacity, filter, CSS variables, offset-distance. Never layout properties per frame. Listeners passive; one rAF loop; ResizeObserver for sizes; full cleanup on unmount/route change.
7. Do NOT use @property with inherits:false for any of the light variables (--gx/--gy/--rim/--boost/--pgx/--pgy) — it freezes the light at the default position.
8. prefers-reduced-motion: skip the opening lap, no continuous animation; light becomes a static soft glow at ~35% where relevant; reveals instant; comets a static soft glow at 40%.
9. If a parent's overflow:hidden clips a flood, shrink that instance's flood — never change my layout.
10. Zero new dependencies. Plain CSS + TypeScript. Current Chrome, Safari (incl. iOS), Edge, Firefox.
11. `spin` on major boxes only (hero panels, auth cards, feature cards, key containers) — never tiny chips, list rows, or text blocks. Most of every screen stays black; light means something.

---

## 9. ACCEPTANCE CHECKLIST (verify ALL before reporting done)

LOAD (every page incl. login): screen is pure black; within the first frame the opening lap starts — the white line runs ~2.5 decelerating laps around every major box, staggered, smooth 60fps, then melts away over ~3.5s. Refreshing replays it.
MOUSE: moving the mouse creates a dark-indigo pool under the cursor and burns the nearest edges of boxes with ONE thick white-to-electric-blue line (never two lines, never gray); box bodies stay dark (no blue flooding the interiors); stopping melts everything over ~3.5s; scrolling alone changes nothing anywhere.
BUTTONS: blue primary with no outline; grey glass with 0.5px hairline; semantic colors only in their roles with hairlines and correct text colors; hover 1.05 / press .85 / disabled 40% on --elev; each flares softly in its own color on movement only.
AI: every AI feature triggers comets within 300ms — on the answer box for box jobs, around the whole screen (twin comets) for page/chat jobs; streaming speeds them up; success does the bright final lap then vanishes with zero leftover DOM; forced error shows the red pulse; nothing orbits when no AI runs.
QUALITY: 60fps in DevTools performance on a mid-range phone, no layout thrash; mobile Safari verified (idle drift active); reduced-motion verified; route changes re-bind everything; no color outside Section 1 anywhere in the UI.

DELIVER BACK: the list of AI entry points instrumented with their scopes, any flood-shrink locations, and a short screen recording showing (a) the opening lap on the login page, (b) mouse-driven light on a content page with scrolling shown doing nothing, and (c) one box-scope AI generation and one page-scope summarize, thinking → streaming → success.
