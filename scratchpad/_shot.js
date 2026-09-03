const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const theme of ['black','light']) {
    const ctx = await b.newContext({ viewport:{width:375,height:812}, isMobile:true, hasTouch:true, deviceScaleFactor:3 });
    const p = await ctx.newPage();
    await p.goto('http://localhost:3262/',{waitUntil:'domcontentloaded'});
    await p.evaluate(([t,th])=>{localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_theme',th);},[process.env.TOK,theme]);
    await p.goto('http://localhost:3262/messages',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(5200);
    await p.evaluate(()=>{const s=document.querySelector('#introSheet:not(.hidden)');if(s&&typeof introDismiss==='function')introDismiss();});
    await p.locator('#acListScreen .ac-item[data-uid]').first().click({timeout:25000});
    await p.waitForSelector('#acThreadScreen:not(.hidden)',{timeout:25000});
    await p.waitForTimeout(1600);
    const clip = async (n,pad=0) => { const r = await p.evaluate((pad)=>{const q=document.querySelector('#acThreadScreen .msg-inbox').getBoundingClientRect();
      return {x:0,y:Math.floor(q.top)-8-pad,width:375,height:Math.ceil(q.height)+16+pad};},pad);
      await p.screenshot({path:'scratchpad/out/'+n+'-'+theme+'.png', clip:r}); };
    await clip('bar1');
    await p.fill('#acInput','The only way I could do that is if I had a lot more time to work on it');
    await p.evaluate(()=>acAutosize()); await p.waitForTimeout(600);
    await clip('bar2');
    await p.evaluate(()=>{rtPresence[AC.peer.id]={online:true};acUpdatePeerPresence();});
    await p.waitForTimeout(600);
    await p.screenshot({path:'scratchpad/out/head-'+theme+'.png', clip:{x:0,y:0,width:375,height:105}});
    // the AI chat composer shares .msg-inbox
    await p.evaluate(()=>appTab('ai')); await p.waitForTimeout(1400);
    const ai = await p.evaluate(()=>{const q=document.querySelector('.msg-compose .msg-inbox');
      if(!q) return null; const r=q.getBoundingClientRect(); return {x:0,y:Math.floor(r.top)-8,width:375,height:Math.ceil(r.height)+16};});
    if (ai) await p.screenshot({path:'scratchpad/out/aibar-'+theme+'.png', clip:ai});
    console.log(theme, 'ai bar', JSON.stringify(ai));
    await ctx.close();
  }
  await b.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
