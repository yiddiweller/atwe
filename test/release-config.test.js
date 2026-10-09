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
 *   - nothing still references the retired `ship` branch;
 *   - one codebase makes exactly two iPhone apps: Atwe (app.json, untouched) and, only
 *     for the beta build profile, Atwe Beta (its own bundle id, scheme and server, no
 *     atwe.com links), and each uploads ONLY to its own App Store Connect app.
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

test('ios-beta.yml builds the beta profile for iOS and uploads it to the Atwe Beta app', () => {
  const { jobs } = workflow('ios-beta.yml');
  assert.deepEqual(Object.keys(jobs).sort(), ['build', 'submit']);
  assert.equal(jobs.build.type, 'build');
  assert.equal(jobs.build.params.platform, 'ios');
  assert.equal(jobs.build.params.profile, 'beta', 'the TestFlight build must use the beta profile (beta.atwe.com)');
  assert.equal(jobs.submit.type, 'submit');
  assert.deepEqual([].concat(jobs.submit.needs), ['build']);
  assert.equal(jobs.submit.params.platform, 'ios');
  assert.equal(jobs.submit.params.profile, 'beta',
    'the submit profile is where the upload goes: a beta build goes to the Atwe Beta app, never to the real Atwe app');
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

/* ── 9. Two apps from one codebase: Atwe and Atwe Beta ───────────────────────
   atwe-mobile/app.config.js turns app.json into exactly one of two apps. With no
   APP_VARIANT it is app.json, untouched: Atwe, the App Store app. With
   APP_VARIANT=beta, which only the `beta` build profile sets, it is Atwe Beta: a
   SEPARATE app (its own bundle id, scheme and server, no atwe.com links) that
   installs beside the real one and is for private TestFlight testing only.

   These checks run the real app.config.js on the real app.json the way Expo does
   (app.json's `expo` object goes in as `config`), so they test what a build would
   actually produce rather than what the file looks like. The upload checks then
   prove that no workflow can send a build of one app to the other app's place in
   App Store Connect, and they prove they would catch it: the beta workflow as it
   was before Atwe Beta existed must fail them. */

const APP_JSON = JSON.parse(read(MOBILE, 'app.json'));
const appConfig = require(path.join(MOBILE, 'app.config.js'));
const PRODUCTION_BUNDLE = APP_JSON.expo.ios.bundleIdentifier;

// Atwe's two App Store Connect apps, and the ONE bundle id each one accepts.
const ASC_APPS = {
  '6789639912': 'com.atwe.app',      // Atwe: the App Store app
  '6821134969': 'com.atwe.app.beta', // Atwe Beta: private TestFlight only, never released
};

const copyOf = (v) => JSON.parse(JSON.stringify(v));

// Resolve the app the way Expo does, with APP_VARIANT set (or unset) for the call only.
function resolveApp(variant, config = copyOf(APP_JSON.expo)) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'APP_VARIANT');
  const was = process.env.APP_VARIANT;
  try {
    if (variant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = variant;
    return appConfig({ config });
  } finally {
    if (had) process.env.APP_VARIANT = was;
    else delete process.env.APP_VARIANT;
  }
}

// Every path at which two configs differ. Arrays are compared whole; a key that is
// present on one side only is reported at that key.
function diffPaths(a, b, at = '') {
  const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (isMap(a) && isMap(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diffPaths(a[k], b[k], at ? at + '.' + k : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [at];
}

// A build profile's env, following `extends` the way EAS does.
function profileEnv(name, cfg = eas, seen = new Set()) {
  const p = cfg.build && cfg.build[name];
  if (!p) throw new Error('eas.json has no build profile "' + name + '"');
  if (seen.has(name)) throw new Error('build profile "' + name + '" extends itself');
  seen.add(name);
  const base = p.extends ? profileEnv(p.extends, cfg, seen) : {};
  return { ...base, ...(p.env || {}) };
}

// The iOS bundle id a build profile actually produces.
const builtBundleId = (profile, cfg = eas) => resolveApp(profileEnv(profile, cfg).APP_VARIANT).ios.bundleIdentifier;

/* Everything wrong with where a workflow sends its builds. A submit profile with no
   bundleIdentifier falls back to the app config, which in a submit job has no
   APP_VARIANT, i.e. the production bundle id. That is why the beta submit profile
   has to name com.atwe.app.beta itself. */
function uploadProblems(wf, cfg = eas) {
  const problems = [];
  const jobs = (wf && wf.jobs) || {};
  for (const [name, job] of Object.entries(jobs)) {
    if (!job || job.type !== 'submit') continue;
    const params = job.params || {};
    const ref = String(params.build_id || '').match(/needs\.([A-Za-z0-9_-]+)\.outputs\.build_id/);
    const build = ref && jobs[ref[1]];
    if (!build || build.type !== 'build' || !build.params) {
      problems.push(name + ': does not upload the output of a build job in this workflow');
      continue;
    }
    const built = builtBundleId(build.params.profile || 'production', cfg);
    const profile = params.profile || 'production';
    const ios = cfg.submit && cfg.submit[profile] && cfg.submit[profile].ios;
    if (!ios) { problems.push(name + ': submit profile "' + profile + '" has no iOS settings'); continue; }
    const owner = ASC_APPS[String(ios.ascAppId)];
    if (!owner) {
      problems.push(name + ': uploads to App Store Connect app ' + ios.ascAppId + ', which is not one of Atwe\'s two apps');
      continue;
    }
    if (owner !== built) {
      problems.push(name + ': uploads a ' + built + ' build to App Store Connect app ' + ios.ascAppId + ', which belongs to ' + owner);
    }
    const named = ios.bundleIdentifier || PRODUCTION_BUNDLE;
    if (named !== built) problems.push(name + ': submit profile "' + profile + '" names ' + named + ' but the build is ' + built);
  }
  return problems;
}

test('app.json is still the production app, exactly: Atwe, com.atwe.app, atwe://, https://atwe.com', () => {
  const app = APP_JSON.expo;
  assert.equal(app.name, 'Atwe');
  assert.equal(app.slug, 'atwe');
  assert.equal(app.scheme, 'atwe');
  assert.equal(app.ios.bundleIdentifier, 'com.atwe.app');
  assert.equal(app.android.package, 'com.atwe.app');
  assert.deepEqual(app.ios.associatedDomains, ['applinks:atwe.com'], 'the production app keeps its atwe.com universal links');
  const hosts = (app.android.intentFilters || []).flatMap((f) => (f.data || []).map((d) => d.host)).sort();
  assert.deepEqual(hosts, ['atwe.com', 'www.atwe.com'], 'the production app keeps its atwe.com Android links');
  assert.equal(app.extra.apiUrl, 'https://atwe.com');
  assert.ok(app.extra.eas && app.extra.eas.projectId, 'both apps build from the one Expo project');
});

test('with no APP_VARIANT, app.config.js returns app.json unchanged (the production app)', () => {
  assert.deepStrictEqual(resolveApp(undefined), APP_JSON.expo, 'production must be app.json byte for byte');
  assert.deepStrictEqual(resolveApp(''), APP_JSON.expo, 'an empty APP_VARIANT is no variant');
});

test('APP_VARIANT=beta is Atwe Beta: its own name, bundle id, package, scheme and server', () => {
  const beta = resolveApp('beta');
  assert.equal(beta.name, 'Atwe Beta');
  assert.equal(beta.ios.bundleIdentifier, 'com.atwe.app.beta');
  assert.equal(beta.android.package, 'com.atwe.app.beta');
  assert.equal(beta.scheme, 'atwe-beta', 'a different scheme, never atwe:// and never none');
  assert.equal(beta.extra.apiUrl, 'https://beta.atwe.com');
  assert.equal(beta.slug, APP_JSON.expo.slug, 'same Expo project slug');
  assert.deepEqual(beta.extra.eas, APP_JSON.expo.extra.eas, 'same Expo project id');
});

test('Atwe Beta claims no atwe.com links: the keys are REMOVED, not emptied', () => {
  const beta = resolveApp('beta');
  assert.ok(!Object.prototype.hasOwnProperty.call(beta.ios, 'associatedDomains'),
    'ios.associatedDomains must be absent: even an empty list writes an Associated Domains entitlement');
  assert.ok(!Object.prototype.hasOwnProperty.call(beta.android, 'intentFilters'),
    'android.intentFilters must be absent: the beta app must not claim atwe.com links');
  assert.doesNotMatch(JSON.stringify(beta), /applinks:/, 'no universal-link domain anywhere in the beta app');
});

test('Atwe Beta differs from the production app ONLY where it has to', () => {
  const expected = ['android.intentFilters', 'android.package', 'extra.apiUrl', 'ios.associatedDomains', 'ios.bundleIdentifier', 'name', 'scheme'];
  assert.deepEqual(diffPaths(resolveApp(undefined), resolveApp('beta')).sort(), expected);
});

test('resolving the beta app does not change the config object Expo hands in', () => {
  const given = copyOf(APP_JSON.expo);
  resolveApp('beta', given);
  assert.deepStrictEqual(given, APP_JSON.expo);
});

test('an APP_VARIANT app.config.js does not know stops the build instead of guessing', () => {
  for (const v of ['production', 'Beta', 'BETA', 'staging', 'beta ', 'prod']) {
    assert.throws(() => resolveApp(v), /unknown APP_VARIANT/, JSON.stringify(v) + ' must not quietly make some app');
  }
});

test('only the beta build profile makes Atwe Beta, and the beta server goes with the beta app and nothing else', () => {
  assert.equal(eas.build.beta.env && eas.build.beta.env.APP_VARIANT, 'beta', 'the beta build profile must set APP_VARIANT=beta');
  for (const name of Object.keys(eas.build)) {
    const env = profileEnv(name);
    const isBeta = env.APP_VARIANT === 'beta';
    if (env.APP_VARIANT !== undefined) assert.equal(env.APP_VARIANT, 'beta', name + ' sets an APP_VARIANT nothing knows');
    assert.equal(isBeta, name === 'beta', name + (isBeta ? ' must not make Atwe Beta' : ' is not the beta profile'));
    assert.equal(env.EXPO_PUBLIC_API_URL === 'https://beta.atwe.com', isBeta,
      name + ': the beta server belongs to the beta app and the beta app to the beta server (a production app talking to beta.atwe.com is the bug this prevents)');
  }
});

test('the beta submit profile uploads to the Atwe Beta app (6821134969) as com.atwe.app.beta', () => {
  const ios = eas.submit.beta && eas.submit.beta.ios;
  assert.ok(ios, 'eas.json has no beta submit profile');
  assert.equal(ios.ascAppId, '6821134969');
  assert.equal(ios.bundleIdentifier, 'com.atwe.app.beta',
    'the beta submit profile must name its bundle id: without one, EAS reads the production one from the app config');
});

test('the production submit profile still uploads to the real Atwe app (6789639912) and nowhere else', () => {
  const ios = eas.submit.production && eas.submit.production.ios;
  assert.ok(ios, 'eas.json has no production submit profile');
  assert.equal(ios.ascAppId, '6789639912');
  assert.ok(ios.bundleIdentifier === undefined || ios.bundleIdentifier === 'com.atwe.app', 'production uploads as com.atwe.app');
  assert.notEqual(eas.submit.beta.ios.ascAppId, ios.ascAppId, 'the two apps can never share an App Store Connect destination');
});

test('every submit profile in eas.json goes to one of the two apps, as that app\'s own bundle id', () => {
  for (const [name, sub] of Object.entries(eas.submit || {})) {
    if (!sub || !sub.ios) continue;
    const owner = ASC_APPS[String(sub.ios.ascAppId)];
    assert.ok(owner, 'submit profile "' + name + '" uploads to ' + sub.ios.ascAppId + ', which is not one of Atwe\'s two apps');
    assert.equal(sub.ios.bundleIdentifier || PRODUCTION_BUNDLE, owner,
      'submit profile "' + name + '" would upload to ' + owner + '\'s App Store Connect app under another bundle id');
  }
});

test('every workflow uploads its build only to the App Store Connect app made for that same app', () => {
  let uploads = 0;
  for (const f of workflowFiles()) {
    const wf = workflow(f);
    assert.deepEqual(uploadProblems(wf), [], f);
    uploads += Object.values(wf.jobs || {}).filter((j) => j && j.type === 'submit').length;
  }
  assert.ok(uploads >= 2, 'the beta and the release workflows should each upload a build');
  assert.equal(builtBundleId(workflow('ios-beta.yml').jobs.build.params.profile), 'com.atwe.app.beta', 'ios-beta.yml builds Atwe Beta');
  assert.equal(builtBundleId(workflow('ios-release.yml').jobs.build.params.profile), 'com.atwe.app', 'ios-release.yml builds Atwe');
});

test('the upload check would catch a beta build aimed at the real Atwe app, in every form that could happen', () => {
  // The beta workflow as it was before Atwe Beta existed: beta build, production upload.
  const oldBeta = parseYaml([
    'jobs:',
    '  build:',
    '    type: build',
    '    params:',
    '      platform: ios',
    '      profile: beta',
    '  submit:',
    '    type: submit',
    '    needs: [build]',
    '    params:',
    '      platform: ios',
    '      profile: production',
    '      build_id: ${{ needs.build.outputs.build_id }}',
  ].join('\n'));
  assert.equal(uploadProblems(oldBeta).length, 2, 'a beta build uploaded with the production submit profile must be caught');

  // The other way round: a production build uploaded to Atwe Beta.
  const crossed = copyOf(oldBeta);
  crossed.jobs.build.params.profile = 'production';
  crossed.jobs.submit.params.profile = 'beta';
  assert.equal(uploadProblems(crossed).length, 2, 'a production build uploaded to Atwe Beta must be caught');

  const beta = workflow('ios-beta.yml');
  const withEas = (change) => { const cfg = copyOf(eas); change(cfg); return uploadProblems(beta, cfg); };
  assert.ok(withEas((c) => { c.submit.beta.ios.ascAppId = '6789639912'; }).length, 'the beta submit profile pointed back at the real Atwe app must be caught');
  assert.ok(withEas((c) => { delete c.submit.beta.ios.bundleIdentifier; }).length, 'a beta submit profile with no bundle id falls back to com.atwe.app and must be caught');
  assert.ok(withEas((c) => { delete c.build.beta.env.APP_VARIANT; }).length, 'a beta build profile that forgets APP_VARIANT builds the real Atwe app and must be caught');
  assert.ok(withEas((c) => { c.submit.beta.ios.ascAppId = '1234567890'; }).length, 'an upload to an App Store Connect app that is not Atwe\'s must be caught');
  assert.deepEqual(withEas(() => {}), [], 'and the real files pass');
});

test('only ios-beta.yml uploads to Atwe Beta, and ios-beta.yml never uploads with the production profile', () => {
  for (const f of workflowFiles()) {
    for (const job of Object.values(workflow(f).jobs || {})) {
      if (!job || job.type !== 'submit') continue;
      const p = (job.params && job.params.profile) || 'production';
      if (p === 'beta') assert.equal(f, 'ios-beta.yml', f + ' uploads with the beta submit profile');
      if (f === 'ios-beta.yml') assert.notEqual(p, 'production', 'ios-beta.yml must never use the production submit profile');
    }
  }
});

test('atwe.com never hands its links to Atwe Beta', () => {
  for (const f of ['apple-app-site-association', 'assetlinks.json']) {
    assert.doesNotMatch(read(ROOT, 'public', '.well-known', f), /com\.atwe\.app\.beta/, f + ' must not name the beta app');
  }
  assert.doesNotMatch(read(ROOT, 'tools', 'native-links.js'), /com\.atwe\.app\.beta/, 'the AASA generator must not name the beta app');
});
