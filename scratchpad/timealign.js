/* The timestamp and the ⋯ must read as ONE cluster in the card's top-right corner.
   They cannot if the time lives inside the name column: that column is fixed-height and
   vertically centred, so the time rides the NAME's line, while the ⋯ is pinned to the top
   of the row (it has to be — its corner is concentric with the card's). */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};
(async()=>{
  const mk=async n=>{const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
    const u='t'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
    const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,verified)
      VALUES ($1,$2,$3,$4,true,true,true) RETURNING id`,[n,e,h,u]); return {id:rows[0].id,u};};
  const me=await mk('Time Probe'), other=await mk('David Khan');
  const t=auth.signToken({id:me.id,email:'x',is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),me.id]);
  await pool.query('INSERT INTO follows (follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[me.id,other.id]);
  await pool.query(`INSERT INTO posts (user_id,body,to_main,created_at) VALUES ($1,'Today a customer drove 40 minutes just to tell us in person how much our work meant to them.',true,now()-interval '14 hours')`,[other.id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];
  for (const [label,w] of [['phone',390],['desktop',1280]]){
    const p=await b.newPage({viewport:{width:w,height:900},deviceScaleFactor:2,hasTouch:w<800,isMobile:w<800});
    p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
    await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(7000);
    await p.evaluate(()=>acSetFeed('following'));
    await p.waitForTimeout(2600);
    const g=await p.evaluate(()=>{
      const post=document.querySelector('#acFeed .ac-post'); if(!post) return null;
      const R=el=>{const r=el.getBoundingClientRect();return {t:+r.top.toFixed(1),b:+r.bottom.toFixed(1),
        l:+r.left.toFixed(1),r:+r.right.toFixed(1),cy:+((r.top+r.bottom)/2).toFixed(1),cx:+((r.left+r.right)/2).toFixed(1)};};
      const time=post.querySelector('.ac-post-time'), more=post.querySelector('.ac-post-more'),
            name=post.querySelector('.ac-post-name'), card=post;
      const pad=parseFloat(getComputedStyle(post).getPropertyValue('--post-pad'))||12;
      const edge=parseFloat(getComputedStyle(post).getPropertyValue('--post-edge'))||0;
      return {time:time&&R(time), more:more&&R(more), name:name&&R(name), card:R(card), pad, edge};
    });
    if(!g||!g.time||!g.more){ ok(false,label+': found a post with a time and a ⋯'); await p.close(); continue; }
    console.log('\n── '+label+' ──');
    console.log('     time  cy '+g.time.cy+'   ⋯ cy '+g.more.cy+'   name cy '+g.name.cy);
    ok(Math.abs(g.time.cy-g.more.cy)<=1,
       'the time and the ⋯ sit on the same line',
       'off by '+Math.abs(g.time.cy-g.more.cy).toFixed(1)+'px');
    // and the cluster hugs the corner: the ⋯ is inset by the card's own padding
    const topInset = g.more.t - g.card.t;
    ok(Math.abs(topInset-g.pad)<=1, 'the ⋯ is still inset by the card padding at the top',
       'inset '+topInset.toFixed(1)+', padding '+g.pad);
    const rightInset = (g.card.r - g.edge) - g.more.r;
    ok(Math.abs(rightInset-g.pad)<=1.5, 'and by the same amount on the right',
       'inset '+rightInset.toFixed(1)+', padding '+g.pad);
    // the time must not collide with the name
    ok(g.time.l >= g.name.r - 0.5, 'the time never overlaps the name',
       'name ends '+g.name.r+', time starts '+g.time.l);
    await p.close();
  }
  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
