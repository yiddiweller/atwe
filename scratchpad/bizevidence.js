/* A VERIFICATION REVIEW MUST SHOW THE EVIDENCE — AND ONLY TO THE PERSON DECIDING.
 *
 * A business submits a registered legal name, a registration number, a note and a
 * photo of a registration document (POST /api/business/verify). `admin.html` has
 * always had markup for all four. It never had the VALUES: `openUser` draws from
 * the in-memory list that `GET /api/admin/users` fills, and that SELECT lists none
 * of them, so every one of those conditionals was permanently falsy. Staff were
 * asked to grant "Verified business" — the badge that also zeroes the platform fee
 * — with nothing at all on screen, after the member had been told the document was
 * "used only for this review".
 *
 * The fix must not be "add them to the bulk list". Opening the Users screen would
 * then ship legal identity and a document image for every account on the page. So
 * there is one narrow read, made when a reviewer opens one account, gated as
 * tightly as the decision it informs — and this probe's job is to prove BOTH
 * halves: the evidence arrives where the decision is made, and nowhere else.
 *
 * Run:  DATABASE_URL=... JWT_SECRET=... node bizevidence.js [--break]
 *       --break serves the dashboard without the lazy fetch, i.e. the shipped bug.
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.includes('--break');
const BASE = QA.base();
const PATHFOR = (id) => '/api/admin/users/' + id + '/business-verification';
let pass = 0, fail = 0;
const say = (ok, w, x) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + w + (x ? '   ' + x : '')); };

const LEGAL = 'QA Bakery Holdings Limited';
const REG = 'QA-99887766';
const NOTE = 'We have traded here since 2012. Certificate attached.';
// A real 48x48 PNG. cleanImage magic-byte sniffs, so a fake string is rejected -
// and a 1x1 would lay out at 1px, which cannot tell a rendered document from a
// broken one.
const DOC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAOUlEQVR42u3OMQ0AAAgDsMnZhX95uCAcTSqgaeeVCAkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQndWbyWbj0DR49AAAAAAElFTkSuQmCC';

async function get(token, p) {
  const r = await fetch(BASE + p, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

async function seed(pool) {
  const superAdmin = await QA.seedAccount(pool, { admin: true, prefix: 'bizsup' });
  const scoped = await QA.seedAccount(pool, { prefix: 'bizscp' });          // staff, 'users' scope, NOT superadmin
  await pool.query(`UPDATE users SET admin_perms = '["users"]'::jsonb, admin_role = 'Support' WHERE id = $1`, [scoped.id]);
  const member = await QA.seedAccount(pool, { prefix: 'bizmem' });          // an ordinary member
  const biz = await QA.seedAccount(pool, { business: true, prefix: 'bizsub' });
  const bare = await QA.seedAccount(pool, { business: true, prefix: 'bizbare' }); // asked, sent nothing
  await pool.query('UPDATE users SET name = $2 WHERE id = $1', [biz.id, 'QA Bakery']);
  for (const a of [superAdmin, scoped, member, biz, bare]) await QA.assertServerSees(a.token, a.username);
  // The business submits through the REAL member route, so what the reviewer sees is
  // what a business really sent — not a row this probe wrote by hand.
  const sub = await fetch(BASE + '/api/business/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + biz.token },
    body: JSON.stringify({ legalName: LEGAL, regNumber: REG, note: NOTE, doc: DOC }),
  });
  if (!sub.ok) throw new Error('the business could not submit its request: ' + sub.status);
  const bareSub = await fetch(BASE + '/api/business/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bare.token },
    body: JSON.stringify({}),
  });
  if (!bareSub.ok) throw new Error('the empty request was refused: ' + bareSub.status);
  return { superAdmin, scoped, member, biz, bare };
}

async function run() {
  const pool = QA.newPool();
  let F;
  try { F = await seed(pool); }
  catch (e) {
    console.log('bizevidence could not seed its own fixture: ' + e.message);
    console.log('DATABASE_URL must be the database the server on ' + BASE + ' was started with.');
    console.log('\n1 FAILED'); process.exit(1);
  }

  /* ══ A. WHO MAY READ IT ══ the gate is the point of the whole design ══ */
  const anon = await get(null, PATHFOR(F.biz.id));
  say(anon.status === 401, 'A1. an unauthenticated request is refused', 'status ' + anon.status);
  const mem = await get(F.member.token, PATHFOR(F.biz.id));
  say(mem.status === 403, 'A2. an ordinary member is refused', 'status ' + mem.status);
  const own = await get(F.biz.token, PATHFOR(F.biz.id));
  say(own.status === 403, 'A3. the business cannot read it through this route either', 'status ' + own.status);
  const scp = await get(F.scoped.token, PATHFOR(F.biz.id));
  say(scp.status === 403, "A4. a scoped staffer is refused — the read is as tight as the decision", 'status ' + scp.status);
  const sup = await get(F.superAdmin.token, PATHFOR(F.biz.id));
  say(sup.status === 200, 'A5. a superadmin may read it', 'status ' + sup.status);
  say(!/legalName|regNumber|note|doc/.test(JSON.stringify(mem.body)) && !/legalName/.test(JSON.stringify(scp.body)),
    'A6. a refusal carries no evidence in its body');

  /* ══ B. WHAT COMES BACK ══ */
  say(sup.body.legalName === LEGAL, 'B1. the legal name is returned', JSON.stringify(sup.body.legalName));
  say(sup.body.regNumber === REG, 'B2. the registration number is returned');
  say(sup.body.note === NOTE, 'B3. their note is returned');
  say(sup.body.doc === DOC, 'B4. the submitted document is returned');
  say(sup.body.status === 'pending' && sup.body.accountType === 'business', 'B5. and the state the decision is about', sup.body.status + ' / ' + sup.body.tier);
  const extra = Object.keys(sup.body).filter((k) => !['accountType', 'status', 'tier', 'legalName', 'regNumber', 'note', 'doc'].includes(k));
  say(extra.length === 0, 'B6. and NOTHING else about the account', extra.length ? 'also sent: ' + extra.join(', ') : '');
  for (const [what, val] of [['email', F.biz.email], ['a password hash', 'password_hash'], ['a balance', 'balanceCents']]) {
    say(!JSON.stringify(sup.body).includes(val), 'B7. no ' + what + ' rides along');
  }

  /* ══ C. ONE ACCOUNT AT A TIME ══ the id in the path is the account answered ══ */
  const other = await get(F.superAdmin.token, PATHFOR(F.bare.id));
  say(other.status === 200 && other.body.legalName === null && other.body.regNumber === null && other.body.doc === null,
    "C1. another business's review returns ITS evidence, not the first one's", JSON.stringify(other.body.legalName));
  const missing = await get(F.superAdmin.token, PATHFOR(999999999));
  say(missing.status === 404, 'C2. an unknown account is a 404', 'status ' + missing.status);
  const bad = await get(F.superAdmin.token, '/api/admin/users/not-a-number/business-verification');
  say(bad.status === 400 || bad.status === 404, 'C3. a non-numeric id is refused', 'status ' + bad.status);

  /* ══ D. THE BULK LIST MUST STAY MINIMAL ══ this is the whole reason for a second route ══ */
  const list = await get(F.superAdmin.token, '/api/admin/users?limit=200');
  const raw = JSON.stringify(list.body);
  say(list.status === 200, 'D1. the users list still loads', 'status ' + list.status);
  say(!raw.includes(LEGAL), 'D2. the bulk users list does NOT carry the legal name');
  say(!raw.includes(REG), 'D3. ...nor the registration number');
  say(!raw.includes(NOTE), 'D4. ...nor their note');
  say(!raw.includes(DOC), 'D5. ...nor the submitted document');
  // Named structurally rather than by value: a bulk row legitimately carries an
  // AVATAR data URL, so "no data: URL anywhere" fails on a perfectly clean list.
  // What must never appear is an evidence COLUMN.
  const evid = ['business_verify_doc', 'business_legal_name', 'business_reg_number', 'business_verify_note'];
  say(evid.every((k) => !raw.includes(k)), 'D6. ...and no evidence column is in the payload at all',
      evid.filter((k) => raw.includes(k)).join(', '));

  /* ══ E. THE DASHBOARD ══ a reviewer opening the account SEES it ══ */
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    const openModal = async (userId) => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      if (BREAK) {
        // The shipped bug: the modal renders, nothing fetches the evidence.
        await ctx.route('**/admin.html', async (route) => {
          const res = await route.fetch();
          const html = (await res.text()).replace("  if (u.account_type === 'business') loadBizEvidence(id);", '');
          await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
        });
      }
      const p = await ctx.newPage();
      // `let token = localStorage.getItem(...)` runs at load, so it must be there first.
      await p.addInitScript((t) => localStorage.setItem('atwe_token', t), F.superAdmin.token);
      await p.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
      await QA.waitUntil(p, () => typeof openUser === 'function' && Array.isArray(window.USERS) && USERS.length > 0, null, 25000);
      await p.evaluate((id) => openUser(id), userId);
      await QA.waitUntil(p, () => {
        const b = document.getElementById('bizEvid');
        return !!b && !/Loading evidence/.test(b.textContent || '');
      }, null, 12000);
      const seen = await p.evaluate(() => {
        const b = document.getElementById('bizEvid');
        const img = b && b.querySelector('img');
        return {
          present: !!b,
          text: b ? (b.textContent || '').replace(/\s+/g, ' ').trim() : '',
          img: img ? { src: (img.getAttribute('src') || '').slice(0, 24), w: Math.round(img.getBoundingClientRect().width), decoded: img.naturalWidth } : null,
        };
      });
      await ctx.close();
      return seen;
    };

    const v = await openModal(F.biz.id);
    say(v.present, 'E1. the review section is on the account page');
    say(v.text.includes(LEGAL), 'E2. the reviewer SEES the legal name', JSON.stringify(v.text.slice(0, 70)));
    say(v.text.includes(REG), 'E3. ...and the registration number');
    say(v.text.includes(NOTE.slice(0, 30)), 'E4. ...and their note');
    say(!!v.img && v.img.src.startsWith('data:image'), 'E5. ...and the document itself, rendered', v.img ? v.img.src + '… ' + v.img.w + 'px' : 'no <img>');
    say(!!v.img && v.img.decoded > 0 && v.img.w >= 40, 'E6. the document really decoded and is laid out, not a broken box', v.img ? v.img.decoded + 'px natural, ' + v.img.w + 'px on screen' : '');

    const e = await openModal(F.bare.id);
    say(e.present && /submitted no details|Nothing submitted/.test(e.text),
      'E7. a request with no evidence says so honestly rather than inventing any', JSON.stringify(e.text.slice(0, 70)));
    say(!e.img, 'E8. ...and draws no document');
  } finally { await browser.close(); }

  /* ══ F. THE DECISION ITSELF IS UNCHANGED ══ */
  const patch = async (tok, body) => {
    const r = await fetch(BASE + '/api/admin/users/' + F.biz.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const byScoped = await patch(F.scoped.token, { businessVerifyTier: 'verified' });
  say(byScoped.status === 403, 'F1. a scoped staffer still cannot grant verification', 'status ' + byScoped.status);
  const grant = await patch(F.superAdmin.token, { businessVerifyTier: 'verified' });
  say(grant.status === 200, 'F2. a superadmin still can', 'status ' + grant.status);
  const after = (await pool.query('SELECT business_verify_status, business_verify_tier, business_verify_doc FROM users WHERE id = $1', [F.biz.id])).rows[0];
  say(after.business_verify_tier === 'verified' && after.business_verify_status === 'verified',
    'F3. granting still settles both tier and status', after.business_verify_tier + ' / ' + after.business_verify_status);
  say(after.business_verify_doc === null, 'F4. and the document is still dropped once a decision is made');
  const afterGrant = await get(F.superAdmin.token, PATHFOR(F.biz.id));
  say(afterGrant.status === 200 && afterGrant.body.doc === null && afterGrant.body.legalName === LEGAL,
    'F5. the review read reflects that: no document, the details kept');
  const remove = await patch(F.superAdmin.token, { businessVerifyTier: 'none' });
  const back = (await pool.query('SELECT business_verify_status, business_verify_tier FROM users WHERE id = $1', [F.biz.id])).rows[0];
  say(remove.status === 200 && back.business_verify_tier === 'none' && back.business_verify_status === 'none',
    'F6. removing verification still works', back.business_verify_tier + ' / ' + back.business_verify_status);

  await pool.end().catch(() => {});
  console.log('\n' + pass + ' passed, ' + fail + ' FAILED');
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.log('CRASH: ' + (e && e.stack || e)); process.exit(1); });
