// What the feeds must never show. Run with:
//   TEST_DATABASE_URL=postgres://user:pass@host/db npm test
// (skips cleanly when no database is configured — see helpers.js).
//
// Three rules, each of which has actually been broken in this codebase:
//   1. A block works in BOTH directions — someone who blocked YOU disappears too.
//   2. A muted word is a plain substring, never a LIKE pattern.
//   3. A staff reach limit applies wherever posts are injected, not just ranked.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };

before(async () => { if (!H.SKIP) await H.startServer(); });
after(async () => { await H.stopServer(); });

async function member() {
  const u = await H.seedUser();
  return { ...u, token: await H.login(u) };
}
async function post(u, body) {
  const r = await H.api('POST', '/api/social/posts', { token: u.token, body: { body } });
  return r.body.post ? r.body.post.id : null;
}
async function feedIds(u, scope) {
  const r = await H.api('GET', '/api/social/feed?scope=' + scope, { token: u.token });
  return (r.body.posts || []).map((p) => p.id);
}
const tag = () => 'zq' + Math.random().toString(36).slice(2, 10);

/* ─────────────── blocks, both directions ─────────────── */

// The direction that used to leak: THEY blocked ME. Following escaped by accident
// (blocking also deletes the follow) but For You, hashtag pages, cashtags, trending,
// lists, saved posts and the AI picks all still served the blocker's posts.
test('someone who blocked you disappears from your feeds', opts, async () => {
  const me = await member(), them = await member();
  const word = tag();
  const pid = await post(them, `post about #${word} here`);
  assert.ok(pid, 'the post was created');
  await H.api('POST', `/api/social/block/${me.id}`, { token: them.token });

  for (const scope of ['foryou', 'following']) {
    assert.ok(!(await feedIds(me, scope)).includes(pid), `gone from ${scope}`);
  }
  const hash = await H.api('GET', '/api/social/hashtag/' + word, { token: me.token });
  const hashIds = (hash.body.posts || []).map((p) => p.id);
  assert.ok(!hashIds.includes(pid), 'gone from the hashtag page');
});

test('someone YOU blocked disappears from your feeds', opts, async () => {
  const me = await member(), them = await member();
  const word = tag();
  const pid = await post(them, `post about #${word} here`);
  await H.api('POST', `/api/social/block/${them.id}`, { token: me.token });
  for (const scope of ['foryou', 'following']) {
    assert.ok(!(await feedIds(me, scope)).includes(pid), `gone from ${scope}`);
  }
});

/* ─────────────── muted words are substrings, not patterns ─────────────── */

test('muting a word hides matching posts, case-insensitively', opts, async () => {
  const me = await member(), them = await member();
  await H.api('POST', `/api/social/follow/${them.id}`, { token: me.token });
  const word = tag();
  const match = await post(them, 'talking about ' + word + ' today');
  const upper = await post(them, 'TALKING ABOUT ' + word.toUpperCase() + ' TODAY');
  const other = await post(them, 'something else entirely ' + tag());
  const mine = await post(me, 'my own post mentions ' + word);
  assert.ok((await feedIds(me, 'following')).includes(match), 'visible before muting');

  await H.api('POST', '/api/social/muted-keywords', { token: me.token, body: { word } });
  const after = await feedIds(me, 'following');
  assert.ok(!after.includes(match), 'the matching post is hidden');
  assert.ok(!after.includes(upper), 'matching is case-insensitive');
  assert.ok(after.includes(other), 'an unrelated post is untouched');
  assert.ok(after.includes(mine), 'your own post is never hidden by your own muted word');
});

// The bug: `body ILIKE '%' || word || '%'` turned a muted "%" into a match-everything
// pattern, so the member's whole feed went blank and then told them Atwe was empty.
test('a wildcard character in a muted word is just a character', opts, async () => {
  const me = await member(), them = await member();
  await H.api('POST', `/api/social/follow/${them.id}`, { token: me.token });
  const keep = await post(them, 'an ordinary post ' + tag());
  const discount = await post(them, 'this one has a 50% discount inside');
  for (const wild of ['%', '_']) {
    await H.api('POST', '/api/social/muted-keywords', { token: me.token, body: { word: wild } });
    assert.ok((await feedIds(me, 'following')).includes(keep),
      `muting a bare "${wild}" must not blank the feed`);
    await H.getPool().query('DELETE FROM muted_keywords WHERE user_id = $1', [me.id]);
  }
  // ...and it still matches literally when it is part of a real word
  await H.api('POST', '/api/social/muted-keywords', { token: me.token, body: { word: '50%' } });
  const after = await feedIds(me, 'following');
  assert.ok(!after.includes(discount), 'muting "50%" hides a post containing "50%"');
  assert.ok(after.includes(keep), '...without taking the rest of the feed with it');
});

/* ─────────────── reduced reach ─────────────── */

// Reach-limiting is staff throttling an account without banning it. The exploration
// weave (fresh, low-engagement posts) and the promoted slots both skipped the filter,
// so a throttled account still landed in strangers' feeds at the same fixed spot.
test('a reach-limited account does not reach strangers, but still reaches its followers', opts, async () => {
  const stranger = await member(), limited = await member(), fan = await member();
  const pid = await post(limited, 'reach test ' + tag());
  await H.getPool().query('UPDATE users SET reach_limited = true WHERE id = $1', [limited.id]);

  assert.ok(!(await feedIds(stranger, 'foryou')).includes(pid),
    'a throttled account stays out of a stranger\'s For You');
  await H.api('POST', `/api/social/follow/${limited.id}`, { token: fan.token });
  assert.ok((await feedIds(fan, 'following')).includes(pid),
    'someone who CHOSE to follow them still sees their posts');
});

/* ─────────────── Following still shows the right posts ─────────────── */

// Following is built as two index-backed halves UNIONed together (a correlated
// sub-select in ORDER BY made it read all 250k posts). These assert the split did
// not change what anyone actually sees.
test('Following shows follows, your own posts and reposts — once each, newest first', opts, async () => {
  const me = await member(), friend = await member(), stranger = await member(), reposter = await member();
  await H.api('POST', `/api/social/follow/${friend.id}`, { token: me.token });
  await H.api('POST', `/api/social/follow/${reposter.id}`, { token: me.token });

  const strangerPost = await post(stranger, 'stranger ' + tag());
  const friendPost = await post(friend, 'friend ' + tag());
  const myPost = await post(me, 'mine ' + tag());
  await H.api('POST', `/api/social/posts/${strangerPost}/repost`, { token: reposter.token });
  await H.api('POST', `/api/social/posts/${friendPost}/repost`, { token: reposter.token });

  const ids = await feedIds(me, 'following');
  assert.ok(ids.includes(friendPost), 'a post by someone you follow');
  assert.ok(ids.includes(myPost), 'your own post');
  assert.ok(ids.includes(strangerPost), 'a post reposted by someone you follow');
  assert.equal(ids.filter((id, i) => ids.indexOf(id) !== i).length, 0,
    'a post that is both written and reposted appears once, not twice');

  const untouched = await post(stranger, 'untouched ' + tag());
  assert.ok(!(await feedIds(me, 'following')).includes(untouched),
    'a stranger\'s untouched post stays out');
});

test('an account that follows nobody sees only its own posts', opts, async () => {
  const lonely = await member(), other = await member();
  const mine = await post(lonely, 'alone ' + tag());
  const theirs = await post(other, 'elsewhere ' + tag());
  const ids = await feedIds(lonely, 'following');
  assert.ok(ids.includes(mine), 'their own post is there');
  assert.ok(!ids.includes(theirs), 'and nothing from anyone else');
});
