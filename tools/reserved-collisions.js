#!/usr/bin/env node
/* Which EXISTING accounts hold a username the new-username gate would now refuse?
 * (Route Audit §45 / batch 1.)
 *
 *   node tools/reserved-collisions.js <database-url>
 *
 * READ-ONLY, and provably so: the query runs inside `BEGIN READ ONLY`, which Postgres
 * itself enforces — any write would error, not happen. It never renames anybody. A hit
 * means a member already holds a word Atwe now protects; they are GRANDFATHERED (their
 * profile keeps working, saving it keeps working) and any resolution is an individual,
 * founder-approved decision, never an automatic rename.
 *
 * There is deliberately NO default database: this is the release gate that must be run
 * against production BEFORE any future namespace change ships there, and a tool that
 * silently picked up DATABASE_URL could be run against the wrong one by accident.
 *
 * THE APPROVED QUERY (Route Audit §45), verbatim apart from binding the reserved set:
 *   SELECT username FROM users
 *    WHERE lower(username) = ANY($1)
 *       OR username ~ '^[._-]|[._-]$|\.\.|\.(html|js|png|json|txt|xml|ico|svg|webmanifest)$';
 * $1 is ALLOCATION_RESERVED from routes.js (the route registry's new-username set).
 */
'use strict';
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { ALLOCATION_RESERVED } = require(path.join(__dirname, '..', 'routes.js'));

const APPROVED_SQL = `SELECT username FROM users
  WHERE lower(username) = ANY($1)
     OR username ~ '^[._-]|[._-]$|\\.\\.|\\.(html|js|png|json|txt|xml|ico|svg|webmanifest)$'
  ORDER BY lower(username)`;

async function run(url) {
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const total = (await client.query('SELECT count(*)::int AS n FROM users WHERE username IS NOT NULL')).rows[0].n;
    const hits = (await client.query(APPROVED_SQL, [ALLOCATION_RESERVED])).rows.map((r) => r.username);
    await client.query('ROLLBACK');
    return { total, hits };
  } finally { client.release(); await pool.end(); }
}

module.exports = { APPROVED_SQL, run };

if (require.main === module) {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: node tools/reserved-collisions.js <database-url>   (no default, on purpose)');
    process.exit(2);
  }
  run(url).then(({ total, hits }) => {
    console.log(`${total} usernames checked, ${hits.length} would be refused as NEW names today.`);
    for (const h of hits) console.log('  ' + h);
    if (hits.length) console.log('These are grandfathered: nothing was changed. Resolve individually, never automatically.');
  }).catch((e) => { console.error('collision check failed:', e.message); process.exit(1); });
}
