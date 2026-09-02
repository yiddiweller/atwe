/* THE SIGN-IN FORM LIVES IN THE LEFT HALF, ON EVERY STEP.
 *
 * Above 1100px the login overlay is two panes — the form on the left, the branding hero
 * fixed to the right 48vw — and the form is held out of the hero by
 * `padding-right: calc(48vw + 64px)`. The "one margin app-wide" work later added
 * `.overlay:has(> .auth-step:not(.hidden)){padding-inline:0}` for PHONES, with no width
 * guard. That dropped the padding on desktop and every wizard step jumped to the middle
 * of the WINDOW, straight across the hero.
 *
 * What made it survive: the START screen is `.auth-inner`, not `.auth-step`, so it kept
 * its padding and looked perfect — only the steps after it were wrong, which is exactly
 * how the founder described it. So this probe checks BOTH, and checks they agree.
 *
 * The target is the centre of the left panel: (window - 48vw) / 2. Checking only that
 * the step "is on the left" would pass on a form hugging the divider.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
const WIDTHS = [1100, 1280, 1512, 1728, 2000];

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  for (const W of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    const want = Math.round((W - W * 0.48) / 2);
    const read = () => p.evaluate(() => {
      const e = [...document.querySelectorAll('#loginOverlay > .auth-inner, #loginOverlay > .auth-step')]
        .find((n) => n.getBoundingClientRect().width > 0);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { kind: e.className.split(' ')[0], cx: Math.round(r.x + r.width / 2) };
    });
    const start = await read();
    await p.getByText(/Login with username/i).first().click();
    await p.waitForTimeout(900);
    const step = await read();
    const ok = start && step && Math.abs(start.cx - want) <= 2 && Math.abs(step.cx - want) <= 2;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : '✗   '} ${String(W).padEnd(5)} left-panel centre ${want}` +
      `   start ${start && start.cx}   step ${step && step.cx}`);
    await ctx.close();
  }
  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthe form is centred in the left panel at every width');
  process.exit(bad ? 1 : 0);
})();
