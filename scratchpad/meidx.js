/* Every Account destination must still be in the search index and still be a real
   function — a search result that does nothing is worse than no result. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,400):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='ix'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin,account_type) VALUES ('I',$1,$2,$3,true,true,true,'business') RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);
  const r = await p.evaluate(()=>{
    const idx = acAppIndex();
    const acct = idx.filter(x=>/^Account/.test(x.sub||''));
    // every Account entry must name a function that actually exists
    const dead = acct.filter(x=>{
      const fn = String(x.run||'').match(/^([A-Za-z_$][\w$]*)\s*\(/);
      return !fn || typeof window[fn[1]] !== 'function';
    }).map(x=>x.label+' → '+x.run);
    /* Comparing the two COUNTS was wrong and cried wolf for a long time: PLACES_EXTRA
       deliberately carries Account-subtitled entries of its own (Add account moved there
       when the hero switcher took it off the hub, and Settings sits there too), so the
       index is legitimately LARGER than the tables declare. What actually matters is that
       nothing declared went MISSING — so check the labels, and report any surplus by name
       instead of failing on it. */
    const lbl = (it) => String(typeof it.l === 'function' ? it.l() : it.l);
    const declaredLabels = [].concat(
      ...ME_SECTIONS.map(g => g.items.map(lbl)), ME_HUB_TAIL.map(lbl), ME_HUB_FOOT.map(lbl));
    /* Findable ANYWHERE, not just under an "Account" subtitle: a destination is indexed
       once, and where two tables name the same place the first subtitle wins. Collections
       is declared on the Account page AND in PLACES_EXTRA subtitled "Home" (it IS a Home
       feed tab; the Account row is a shortcut to it), so it is correctly indexed as Home.
       Looking only at the Account slice reported it as missing on correct code. */
    const anywhere = new Set(idx.map(x => String(x.label)));
    const indexed = new Set(acct.map(x => String(x.label)));
    const missing = declaredLabels.filter(l => !anywhere.has(l));
    const surplus = [...indexed].filter(l => !declaredLabels.includes(l));
    return { total: idx.length, acct: acct.length, declared: declaredLabels.length, dead,
      missing, surplus,
      admin: acct.filter(x=>/admin dashboard/i.test(x.label)).map(x=>x.sub),
      dupes: acct.map(x=>x.label).filter((v,i,a)=>a.indexOf(v)!==i) };
  });
  console.log('  '+JSON.stringify(r).slice(0,500));
  ok(r.missing.length===0, 'every declared Account row is in the search index',
     'not indexed: '+JSON.stringify(r.missing));
  ok(r.dead.length===0, 'and every one of them runs a real function', JSON.stringify(r.dead));
  ok(r.dupes.length===0, 'no destination is listed twice', JSON.stringify(r.dupes));
  ok(r.admin.length===1 && r.admin[0]==='Account',
     'Admin dashboard is indexed once, at the top level (not inside a section)', JSON.stringify(r.admin));
  ok(r.total>130, 'the whole app index is still large', 'total='+r.total);
  ok(errs.length===0,'no JS errors',errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
