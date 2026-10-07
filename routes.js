/* Atwe's system routes — the words that are real addresses on atwe.com and can
   therefore never be registered as a username.
 *
 * Since Route Audit batch 0/1 these come from ONE place, the route registry
 * (public/atwe-routes.js), which the page, the server and the tests all read:
 *
 *   SYSTEM_ROUTES        the words seeded into the reserved_usernames table on every
 *                        boot (lockSystemRoutes). Since build 1877 this is the registry's
 *                        seedReserved(): the router set PLUS the defensive words an
 *                        existing holder keeps (`atwe`, `support`, `about` …). Its value
 *                        is exactly what it was in build 1876 — narrowing what the
 *                        ROUTER claims must never narrow what a new account is refused.
 *                        The router's own set is REGISTRY.parseReserved(), which
 *                        test/routes.test.js and test/route-registry.test.js hold equal
 *                        to the client's RESERVED_PATHS.
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

const SYSTEM_ROUTES = REG.seedReserved();
const ALLOCATION_RESERVED = REG.allocationReserved();

module.exports = { SYSTEM_ROUTES, ALLOCATION_RESERVED, REGISTRY: REG };
