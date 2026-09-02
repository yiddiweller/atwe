const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4399';
const ROUTES = ['/wallet','/wallet-send','/wallet-requests','/wallet-topup','/wallet-cashout',
 '/invoices','/quotes','/splits','/pools','/scheduled-payments','/payment-links','/gift-cards',
 '/rewards','/referrals','/sell','/store','/offers','/offer-service','/sales','/business-analytics',
 '/post-job','/jobs?scope=mine','/jobs?scope=applied','/jobs?scope=saved','/workers',
 '/orders','/cart','/addresses','/subscriptions','/lists','/courses','/newsletters','/showcase',
 '/appointments','/events','/edit-profile','/close-friends','/settings','/settings/account',
 '/settings/privacy','/settings/notifications','/settings/display','/settings/about',
 '/me/profile','/me/money','/me/selling','/me/growth','/me/jobs','/me/library','/me/planning',
 '/me/app','/feedback','/settings/security','/settings/data'];
(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:1,
    isMobile:true, hasTouch:true, colorScheme: process.env.THEME==='light'?'light':'dark' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0,140)));
  page.on('console', m => { if (m.type()==='error') errs.push('console: '+m.text().slice(0,140)); });
  await page.goto(BASE + '/', {waitUntil:'networkidle'}); await page.waitForTimeout(2600);
  await page.getByText('Continue with Email').click(); await page.waitForTimeout(1300);
  await page.locator('input').first().click();
  await page.keyboard.type(process.env.EM,{delay:8}); await page.waitForTimeout(250);
  await page.getByText(/^Continue$/).first().click(); await page.waitForTimeout(2400);
  await page.locator('input').first().click();
  await page.keyboard.type('previewpass123',{delay:8}); await page.waitForTimeout(250);
  await page.getByText(/^Log in$|^Continue$/).first().click(); await page.waitForTimeout(6500);
  let bad = 0;
  for (const r of ROUTES) {
    const before = errs.length;
    await page.goto(BASE + r, {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(1500);
    const txt = (await page.locator('body').innerText()).replace(/\s+/g,' ').trim();
    const fresh = errs.slice(before);
    const empty = txt.length < 4;
    if (fresh.length || empty) { bad++; console.log('✗', r, empty ? '(blank)' : fresh[0]); }
  }
  console.log(`\n${ROUTES.length} screens · ${bad} with a problem · ${errs.length} errors total (${process.env.THEME||'dark'})`);
  await b.close();
})();
