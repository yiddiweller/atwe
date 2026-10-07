#!/usr/bin/env node
/**
 * Walk every signed-out screen, in both themes, and shoot it — plus the one
 * mechanical check that a screenshot alone will not give you: does a focused
 * text field draw a ring?
 *
 * It exists because the founder spotted a yellow box round a field in a
 * screenshot. It was not the app — react-native-web renders a TextInput as a
 * real `<input>` and the BROWSER paints `outline-style: auto` on one; a phone's
 * native field has no outline to draw. But the pictures they judge from have to
 * show what a phone shows, so the web build suppresses it and this proves it
 * stayed suppressed.
 *
 * Needs the web build served at the root of an origin that proxies /api — see
 * PROJECT-STATUS, "Looking at the screens".
 *
 *   PW=<dir with node_modules/playwright-core> CHROME=<chrome> \
 *   APP=http://localhost:4399 OUT=<dir> SCHEME=dark EMAIL=<an account> \
 *     node tools/check-auth-screens.js
 */
const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const OUT = process.env.OUT, BASE = process.env.APP, SCHEME = process.env.SCHEME;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, colorScheme: SCHEME,
  });
  const p = await ctx.newPage();
  const shot = async (n) => { await p.waitForTimeout(1100); await p.screenshot({ path: `${OUT}/${SCHEME}-${n}.png` }); };
  const rings = [];
  /* After focusing a field, ask what outline it actually has. */
  const checkRing = async (label) => {
    const el = p.locator('input:focus, textarea:focus').first();
    if (!(await el.count())) return;
    const o = await el.evaluate((n) => {
      const cs = getComputedStyle(n);
      return `${cs.outlineStyle}/${cs.outlineWidth}/${cs.boxShadow}`;
    });
    if (!/^none\//.test(o) || (o.split('/')[2] && o.split('/')[2] !== 'none')) rings.push(`${label}: ${o}`);
  };

  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(4200);
  await shot('1-landing');
  await p.getByText('Continue with Email').click(); await p.waitForTimeout(900);
  await p.getByPlaceholder('you@example.com').click(); await p.waitForTimeout(300);
  await checkRing('login email'); await shot('2-email');
  await p.getByPlaceholder('you@example.com').fill(process.env.EMAIL);
  await p.getByText('Continue', { exact: true }).click(); await p.waitForTimeout(1700);
  await p.getByPlaceholder('Password').click(); await p.waitForTimeout(300);
  await checkRing('password'); await shot('3-password');
  await p.getByRole('button', { name: 'Back' }).click(); await p.waitForTimeout(700);
  await p.getByPlaceholder('you@example.com').fill('nobody-here@example.com');
  await p.getByText('Continue', { exact: true }).click(); await p.waitForTimeout(1800);
  await shot('4-create-offer');
  await p.getByText('Create an account').click(); await p.waitForTimeout(1400);
  await shot('5-kind');
  await p.getByText('A business', { exact: true }).click(); await p.waitForTimeout(300);
  await p.getByText('Continue', { exact: true }).click(); await p.waitForTimeout(1100);
  await checkRing('signup email'); await shot('6-signup-email');
  // username login
  await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(4200);
  await p.getByText('Login with username').click(); await p.waitForTimeout(900);
  await p.getByPlaceholder('username').click(); await p.waitForTimeout(300);
  await checkRing('username'); await shot('7-username');

  console.log(SCHEME, 'fields with a ring:', rings.length, rings.join(' | '));
  await b.close();
})();
