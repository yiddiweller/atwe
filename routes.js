/* Atwe's system routes — the words that are real addresses on atwe.com and can
   therefore never be registered as a username.
 *
 * Since Route Audit batch 0/1 these come from ONE place, the route registry
 * (public/atwe-routes.js), which the page, the server and the tests all read:
 *
 *   SYSTEM_ROUTES        the words the ROUTER refuses as a handle today. Seeded into
 *                        the reserved_usernames table on every boot (lockSystemRoutes)
 *                        and used by the crawler preview to skip non-profiles. Its value
 *                        is unchanged from the literal list this file used to carry —
 *                        test/routes.test.js still requires it to equal the client's
 *                        RESERVED_PATHS, and test/route-registry.test.js requires the
 *                        registry to equal that too.
 *
 *   ALLOCATION_RESERVED  the larger set a NEW username is checked against: the above
 *                        plus every approved future route root, the server-owned roots
 *                        (/go, /s, /catalog, /_diag, /__shell, /.well-known) and the
 *                        near-term Atwe namespaces. Enforced in code (server.js
 *                        newUsernameError), deliberately NOT seeded into the database:
 *                        nobody who already holds one of these words is renamed or
 *                        loses their atwe.com/<name>, and a deploy writes no new rows.
 */
const REG = require('./public/atwe-routes.js');

const SYSTEM_ROUTES = REG.parseReserved();
const ALLOCATION_RESERVED = REG.allocationReserved();

module.exports = { SYSTEM_ROUTES, ALLOCATION_RESERVED, REGISTRY: REG };
