/* Release configuration: the shape of how Atwe reaches people, held in place.
 *
 * Three long-lived branches, development -> beta -> main, promoted by exact-commit
 * fast-forward (docs/BRANCHES-AND-RELEASES.md). This file guards the parts of that
 * model that live in the repository:
 *
 *   - the web build stamps move together (ATWE_BUILD, sw.js CACHE, atwe-routes.js?v=);
 *   - NO EAS workflow can start a native build from a push to any branch;
 *   - the TestFlight workflow (ios-beta.yml) has no automatic trigger at all;
 *   - the App Store workflow (ios-release.yml) fires only on a `release-ios-*` tag;
 *   - the beta build profile talks to https://beta.atwe.com, production to https://atwe.com;
 *   - nothing still references the retired `ship` branch.
 *
 * No server, database, network or new dependency. The workflow files are read with a
 * small YAML-subset reader below, which REFUSES anything it does not understand rather
 * than guessing, and which proves on every run that it would have caught the old
 * mobile-beta.yml (it built on every push to beta and ship).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MOBILE = path.join(ROOT, 'atwe-mobile');
const WF_DIR = path.join(MOBILE, '.eas', 'workflows');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/* ── A strict YAML-subset reader ─────────────────────────────────────────────
   Enough for EAS workflow files: block mappings, block sequences (including
   sequences of mappings), flow sequences of scalars, quoted and plain scalars,
   block scalars (| and >), and comments. Keys stay STRINGS, so a bare `on` is
   the key "on" (YAML 1.2, which is how EAS reads it), never the boolean true.
   Anything else (flow mappings, anchors, tabs) throws, so a future workflow
   written in an unsupported style fails this test loudly instead of slipping
   past it. */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === '"') { if (c === '\\') { i++; continue; } if (c === '"') q = null; continue; }
    if (q === "'") { if (c === "'") q = null; continue; }
    if ((c === '"' || c === "'") && (i === 0 || /[\s\[,:{-]/.test(line[i - 1]))) { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function unquote(s) {
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new Error('unterminated quoted scalar: ' + s);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new Error('unterminated quoted scalar: ' + s);
    return JSON.parse(s);
  }
  if (/^[&*!|>%@`{]/.test(s)) throw new Error('unsupported YAML scalar: ' + s);
  return s;
}

function splitFlow(inner) {
  const out = [];
  let cur = '', q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') throw new Error('nested flow collections are not supported: [' + inner + ']');
    if (c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(unquote);
}

function scalarOrFlow(rest) {
  if (rest.startsWith('[')) {
    if (!rest.endsWith(']')) throw new Error('unterminated flow sequence: ' + rest);
    return splitFlow(rest.slice(1, -1));
  }
  if (rest.startsWith('{')) throw new Error('flow mappings are not supported: ' + rest);
  return unquote(rest);
}

const KEY_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s'"\[\]{},:#][^:]*?)\s*:(?:\s+(.*))?$/;
const isSeqItem = (t) => t === '-' || t.startsWith('- ');

function parseYaml(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const s = stripComment(raw).replace(/\s+$/, '');
    if (!s.trim()) continue;
    const lead = s.match(/^[ \t]*/)[0];
    if (lead.includes('\t')) throw new Error('tab indentation is not allowed: ' + JSON.stringify(raw));
    if (s.trim() === '---' || s.trim() === '...') continue;
    lines.push({ indent: lead.length, text: s.trim() });
  }
  let i = 0;

  function block(parentIndent) {
    if (i >= lines.length || lines[i].indent <= parentIndent) return null;
    return isSeqItem(lines[i].text) ? seq(lines[i].indent) : map(lines[i].indent);
  }
  function map(indent) {
    const obj = {};
    while (i < lines.length && lines[i].indent === indent && !isSeqItem(lines[i].text)) {
      const m = lines[i].text.match(KEY_RE);
      if (!m) throw new Error('expected "key: value", got: ' + lines[i].text);
      const key = unquote(m[1]);
      const rest = (m[2] || '').trim();
      if (Object.prototype.hasOwnProperty.call(obj, key)) throw new Error('duplicate key: ' + key);
      i++;
      if (/^[|>][+-]?[0-9]?$/.test(rest)) {
        const body = [];
        while (i < lines.length && lines[i].indent > indent) body.push(lines[i++].text);
        obj[key] = body.join('\n');
      } else if (rest !== '') {
        obj[key] = scalarOrFlow(rest);
      } else if (i < lines.length && lines[i].indent > indent) {
        obj[key] = block(indent);
      } else if (i < lines.length && lines[i].indent === indent && isSeqItem(lines[i].text)) {
        obj[key] = seq(indent);
      } else {
        obj[key] = null;
      }
    }
    if (i < lines.length && lines[i].indent > indent) throw new Error('unexpected indentation at: ' + lines[i].text);
    return obj;
  }
  function seq(indent) {
    const arr = [];
    while (i < lines.length && lines[i].indent === indent && isSeqItem(lines[i].text)) {
      const rest = lines[i].text.replace(/^-\s*/, '');
      if (rest === '') { i++; arr.push(block(indent)); continue; }
      if (KEY_RE.test(rest) && !/^['"]/.test(rest)) {
        // "- key: value" starts a mapping whose keys sit where `key` sits
        lines[i] = { indent: indent + (lines[i].text.length - rest.length), text: rest };
        arr.push(map(lines[i].indent));
        continue;
      }
      i++;
      arr.push(scalarOrFlow(rest));
    }
    return arr;
  }

  const doc = block(-1);
  if (i < lines.length) throw new Error('could not read past: ' + lines[i].text);
  if (doc === null || Array.isArray(doc) || typeof doc !== 'object') throw new Error('a workflow must be a mapping');
  return doc;
}

/* ── What can start a workflow without a person? ──────────────────────────────
   EAS: a workflow with no `on` runs only when somebody starts it. Under `on.push`,
   if `branches` and `tags` are BOTH absent, EAS defaults branches to ['*'], i.e.
   every push to every branch. Given only `tags`, branches defaults to []. */
function triggerProblems(wf) {
  const problems = [];
  if (!Object.prototype.hasOwnProperty.call(wf, 'on') || wf.on === null) return problems;
  const on = wf.on;
  if (typeof on === 'string' || Array.isArray(on)) {
    for (const ev of [].concat(on)) problems.push('`on: ' + ev + '` fires on ' + (ev === 'push' ? 'every push to every branch' : 'every ' + ev));
    return problems;
  }
  for (const [ev, cfg] of Object.entries(on)) {
    if (ev !== 'push') { problems.push('`on.' + ev + '` starts a build automatically'); continue; }
    const c = cfg || {};
    const branches = c.branches;
    const tags = c.tags;
    const hasTags = Array.isArray(tags) ? tags.length > 0 : !!tags;
    const hasBranches = Array.isArray(branches) ? branches.length > 0 : branches != null;
    if (hasBranches) problems.push('`on.push.branches` builds on a branch push: ' + JSON.stringify(branches));
    else if (!hasTags) problems.push('`on.push` with neither branches nor tags builds on EVERY push to EVERY branch');
  }
  return problems;
}

function tagPatterns(wf) {
  const t = wf && wf.on && typeof wf.on === 'object' && !Array.isArray(wf.on) && wf.on.push && wf.on.push.tags;
  return t ? [].concat(t) : [];
}
// EAS tag filters are globs: `*` stays inside one path segment, `**` crosses them.
function globRe(g) {
  const esc = g.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + esc.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*') + '$');
}
const matchesTag = (wf, tag) => tagPatterns(wf).some((g) => globRe(g).test(tag));

const workflowFiles = () => fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const workflow = (f) => parseYaml(read(WF_DIR, f));
const nonComment = (text) => text.split(/\r?\n/).map(stripComment).join('\n');

/* ── The reader, proved before it is trusted ─────────────────────────────── */

test('the YAML reader understands what a workflow file can say', () => {
  const doc = parseYaml([
    "'on':   # quoted key, trailing comment",
    '  push:',
    "    tags: ['release-ios-*', \"x#y\"]  # a # inside quotes is not a comment",
    'jobs:',
    '  build:',
    '    needs: [a, b]',
    '    params:',
    '      platform: ios',
    '      build_id: ${{ needs.build.outputs.build_id }}',
    '  custom:',
    '    steps:',
    '      - uses: eas/checkout',
    '      - run: |',
    '          echo one',
    '          echo two',
    '        name: two lines',
    '      - plain item',
  ].join('\n'));
  assert.deepEqual(doc.on.push.tags, ['release-ios-*', 'x#y']);
  assert.deepEqual(doc.jobs.build.needs, ['a', 'b']);
  assert.equal(doc.jobs.build.params.build_id, '${{ needs.build.outputs.build_id }}');
  assert.equal(doc.jobs.custom.steps[0].uses, 'eas/checkout');
  assert.equal(doc.jobs.custom.steps[1].run, 'echo one\necho two');
  assert.equal(doc.jobs.custom.steps[1].name, 'two lines');
  assert.equal(doc.jobs.custom.steps[2], 'plain item');
  for (const bad of ['on: { push: {} }', 'a:\n\tb: c', 'a: &anchor x', 'just a line', 'a: 1\na: 2']) {
    assert.throws(() => parseYaml(bad), 'should refuse: ' + JSON.stringify(bad));
  }
});

test('the trigger check catches every way a workflow can build on a branch push', () => {
  // The workflow this repository actually had until Gate B: it built on beta AND ship.
  const oldBeta = parseYaml([
    'name: Atwe beta (TestFlight)',
    'on:',
    '  push:',
    "    branches: ['beta', 'ship']",
    '    paths:',
    "      - 'atwe-mobile/**'",
    "      - '!**/*.md'",
    'jobs:',
    '  build:',
    '    type: build',
  ].join('\n'));
  assert.equal(triggerProblems(oldBeta).length, 1, 'the old mobile-beta.yml must be caught');
  assert.ok(triggerProblems(parseYaml('on:\n  push:\n    paths: [a]\njobs:\n  x: y')).length, 'push with no branches/tags = every branch');
  assert.ok(triggerProblems(parseYaml('on:\n  push:\njobs:\n  x: y')).length, 'a bare push = every branch');
  assert.ok(triggerProblems(parseYaml('on: push\njobs:\n  x: y')).length, '`on: push` = every branch');
  assert.ok(triggerProblems(parseYaml('on: [push]\njobs:\n  x: y')).length, '`on: [push]` = every branch');
  assert.ok(triggerProblems(parseYaml("on:\n  pull_request:\n    branches: ['main']\njobs:\n  x: y")).length, 'a pull_request trigger is automatic too');
  assert.ok(triggerProblems(parseYaml("on:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  x: y")).length, 'a schedule is automatic too');
  assert.deepEqual(triggerProblems(parseYaml("on:\n  push:\n    tags: ['release-ios-*']\njobs:\n  x: y")), [], 'tags only is not a branch trigger');
  assert.deepEqual(triggerProblems(parseYaml('name: manual\njobs:\n  x: y')), [], 'no `on` = manual only');
  assert.ok(globRe('release-ios-*').test('release-ios-26.8.1') && !globRe('release-ios-*').test('release-android-1'));
  assert.ok(globRe('release-*').test('release-android-1'), 'a generic release-* would catch other platforms');
});

/* ── 1-2. The web build stamps move together ──────────────────────────────── */

const html = read(ROOT, 'public', 'index.html');
const BUILD = (html.match(/const ATWE_BUILD = '(\d+)'/) || [])[1];

test('sw.js CACHE is atwe-v + ATWE_BUILD', () => {
  assert.ok(BUILD, 'ATWE_BUILD not found in public/index.html');
  const cache = (read(ROOT, 'public', 'sw.js').match(/const CACHE = '([^']+)'/) || [])[1];
  assert.equal(cache, 'atwe-v' + BUILD, 'public/sw.js CACHE must equal atwe-v' + BUILD + ', or old clients keep a stale shell');
});

test('the route registry asset version equals ATWE_BUILD', () => {
  const tag = html.match(/<script src="\/atwe-routes\.js\?v=(\d+)"><\/script>/);
  assert.ok(tag, 'index.html does not load /atwe-routes.js?v=<build>');
  assert.equal(tag[1], BUILD, 'atwe-routes.js?v= must equal ATWE_BUILD');
});

/* ── 3-5, 8. The native workflows ─────────────────────────────────────────── */

test('the two iOS workflows exist and the retired ones are gone', () => {
  const files = workflowFiles();
  for (const f of ['ios-beta.yml', 'ios-release.yml']) assert.ok(files.includes(f), f + ' is missing');
  for (const f of ['build-ios.yml', 'mobile-beta.yml', 'mobile-production.yml']) {
    assert.ok(!files.includes(f), f + ' is retired and must not come back');
  }
  for (const f of files) assert.doesNotThrow(() => workflow(f), f + ' must be readable');
});

test('NO EAS workflow builds on a push to any branch, or on anything automatic but a release tag', () => {
  for (const f of workflowFiles()) {
    assert.deepEqual(triggerProblems(workflow(f)), [], f + ' can start a native build automatically');
  }
});

test('ios-beta.yml is manual only: no `on` at all', () => {
  const wf = workflow('ios-beta.yml');
  assert.ok(!Object.prototype.hasOwnProperty.call(wf, 'on'), 'ios-beta.yml must have no `on:` block (manual only)');
  assert.deepEqual(tagPatterns(wf), []);
});

test('ios-beta.yml builds the beta profile for iOS and uploads it with the working submit settings', () => {
  const { jobs } = workflow('ios-beta.yml');
  assert.deepEqual(Object.keys(jobs).sort(), ['build', 'submit']);
  assert.equal(jobs.build.type, 'build');
  assert.equal(jobs.build.params.platform, 'ios');
  assert.equal(jobs.build.params.profile, 'beta', 'the TestFlight build must use the beta profile (beta.atwe.com)');
  assert.equal(jobs.submit.type, 'submit');
  assert.deepEqual([].concat(jobs.submit.needs), ['build']);
  assert.equal(jobs.submit.params.platform, 'ios');
  assert.equal(jobs.submit.params.profile, 'production', 'the submit profile is where the upload goes, and production is the one that works');
  assert.match(jobs.submit.params.build_id, /needs\.build\.outputs\.build_id/);
});

test('ios-release.yml fires ONLY on a `release-ios-*` tag and builds the production profile', () => {
  const wf = workflow('ios-release.yml');
  assert.deepEqual(wf.on, { push: { tags: ['release-ios-*'] } }, 'the store trigger must be exactly on.push.tags: [release-ios-*]');
  const { jobs } = wf;
  assert.equal(jobs.build.params.platform, 'ios');
  assert.equal(jobs.build.params.profile, 'production');
  assert.equal(jobs.submit.params.platform, 'ios');
  assert.equal(jobs.submit.params.profile, 'production');
});

test('only ios-release.yml answers a release-ios-* tag, and no workflow catches other release tags', () => {
  for (const f of workflowFiles()) {
    const wf = workflow(f);
    assert.equal(matchesTag(wf, 'release-ios-26.8.1'), f === 'ios-release.yml', f + ' and release-ios-* tags');
    for (const other of ['release-26.8.1', 'release-android-26.8.1', 'release-mac-1', 'release-windows-1', 'web-1879']) {
      assert.ok(!matchesTag(wf, other), f + ' would also fire on the tag ' + other);
    }
  }
});

test('every job in every workflow is iOS only (Android has no Play account or upload key yet)', () => {
  for (const f of workflowFiles()) {
    for (const [name, job] of Object.entries(workflow(f).jobs || {})) {
      if (job && job.params && 'platform' in job.params) assert.equal(job.params.platform, 'ios', f + ' job ' + name);
    }
  }
});

test('no workflow references the retired `ship` branch', () => {
  for (const f of workflowFiles()) {
    assert.doesNotMatch(nonComment(read(WF_DIR, f)), /\bship\b/, f + ' still names ship outside a comment');
  }
});

/* ── 6-7. The build profiles ──────────────────────────────────────────────── */

const eas = JSON.parse(read(MOBILE, 'eas.json'));

test('the beta profile talks to https://beta.atwe.com and is a store build that raises its own number', () => {
  const beta = eas.build.beta;
  assert.ok(beta, 'eas.json has no beta build profile');
  assert.equal(beta.env && beta.env.EXPO_PUBLIC_API_URL, 'https://beta.atwe.com');
  assert.equal(beta.autoIncrement, true, 'each beta build needs a new build number');
  assert.notEqual(beta.distribution, 'internal', 'TestFlight only accepts a store-signed build');
  assert.ok(!(beta.ios && beta.ios.simulator), 'a simulator build cannot go to TestFlight');
  assert.equal(eas.cli.appVersionSource, 'remote', 'build numbers are kept by EAS, not in app.json');
});

test('the production profile talks to https://atwe.com', () => {
  const prod = eas.build.production;
  assert.ok(prod, 'eas.json has no production build profile');
  assert.equal(prod.env && prod.env.EXPO_PUBLIC_API_URL, 'https://atwe.com');
  assert.equal(prod.autoIncrement, true);
});

test('every submit profile a workflow uses exists in eas.json', () => {
  for (const f of workflowFiles()) {
    for (const job of Object.values(workflow(f).jobs || {})) {
      if (job && job.type === 'submit') {
        const p = (job.params && job.params.profile) || 'production';
        assert.ok(eas.submit && eas.submit[p] && eas.submit[p].ios, f + ' submits with profile "' + p + '", which has no iOS settings');
      }
      if (job && job.type === 'build') {
        assert.ok(eas.build[job.params.profile], f + ' builds profile "' + job.params.profile + '", which eas.json does not define');
      }
    }
  }
});

test('native signing and store credential files can never be committed', () => {
  const ignore = read(ROOT, '.gitignore').split(/\r?\n/).map((l) => l.trim());
  for (const p of ['play-service-account.json', '*.p8', '*.p12', '*.jks', '*.keystore', '*.mobileprovision', 'google-services.json', 'GoogleService-Info.plist']) {
    assert.ok(ignore.includes(p), '.gitignore is missing ' + p);
  }
});
