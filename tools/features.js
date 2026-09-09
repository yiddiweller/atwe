#!/usr/bin/env node
/* THE FEATURE LIST HAS EXACTLY TWO STATES — built, and still to do.
 *
 * The owner's instruction (9 Sep 2026), and it is the whole design of this tool:
 *   "You can delete the skipped features entirely. I don't need it at all, so we should
 *    only have the features we have and the features we still need to do. And once we have
 *    something we did of the features we have to do, it automatically goes into the features
 *    we have and the features we do has now one less. Automatic official system. But keep in
 *    mind if somehow we add like a small feature or a touch-up, make sure it's going into
 *    the list — it doesn't get ignored."
 *
 * So: `done` moves an item across and the to-do count drops by one, and `add` is how a small
 * feature or a touch-up gets onto the list instead of vanishing. There is no third state.
 * The four `excluded` rows were deleted outright — and they were not harmless: public/
 * features.html marks a row planned ONLY when its phase is roadmap|admin_idea, so `excluded`
 * rendered as DONE and the owner's own Features tab was reporting 565 built instead of 561.
 *
 * Usage
 *   node tools/features.js                      the two numbers
 *   node tools/features.js todo                 what is left, with ids
 *   node tools/features.js done <id> [<id>…]    mark shipped (to-do drops by one each)
 *   node tools/features.js add "Name" "What it does" ["Category"] [--todo]
 *                                               a new feature or touch-up. Defaults to
 *                                               BUILT, because this is normally called
 *                                               right after shipping something; --todo
 *                                               puts it on the to-do list instead.
 *
 * `web` vs `app`: an item is the phone app's if its category says so. The web count is what
 * "finish the web app" is measured against.
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'features-data.js');

const BUILT = ['inv', 'admin_have'];
const TODO = ['roadmap', 'admin_idea'];
const isBuilt = (f) => BUILT.includes(f.phase);
const isTodo = (f) => TODO.includes(f.phase);
/* An admin-dashboard item goes back as admin_have, everything else as inv — so moving an
   item across never quietly reclassifies which surface it belongs to. */
const donePhase = (f) => (f.phase === 'admin_idea' ? 'admin_have' : 'inv');

function load() { delete require.cache[require.resolve(FILE)]; return require(FILE); }
function save(list) {
  const head = fs.readFileSync(FILE, 'utf8').split('module.exports =')[0];
  fs.writeFileSync(FILE, head + 'module.exports = ' +
    JSON.stringify(list, null, 0).replace(/\},\{/g, '},\n{') + ';\n');
}
function nextId(list) {
  /* ids are a letter plus a number; keep the shape and never collide */
  let n = 0;
  for (const f of list) { const m = /^n(\d+)$/.exec(String(f.id)); if (m) n = Math.max(n, +m[1]); }
  return 'n' + (n + 1);
}
const counts = (list) => ({
  built: list.filter(isBuilt).length,
  todo: list.filter(isTodo).length,
});

const [cmd, ...args] = process.argv.slice(2);
const list = load();

if (!cmd || cmd === 'count') {
  const c = counts(list);
  console.log(c.built + ' built · ' + c.todo + ' to do');
  process.exit(0);
}

if (cmd === 'todo') {
  const left = list.filter(isTodo);
  if (!left.length) { console.log('nothing left to do'); process.exit(0); }
  for (const f of left) console.log('  ' + String(f.id).padEnd(6) + (f.name || '') + '   [' + (f.cat || '') + ']');
  console.log('\n' + left.length + ' to do');
  process.exit(0);
}

if (cmd === 'done') {
  if (!args.length) { console.error('which one? node tools/features.js done <id>'); process.exit(1); }
  const before = counts(list);
  const moved = [];
  for (const id of args) {
    const f = list.find((x) => String(x.id) === String(id));
    if (!f) { console.error('no such id: ' + id); process.exit(1); }
    if (isBuilt(f)) { console.error(id + ' (' + f.name + ') is already built — nothing to do'); process.exit(1); }
    f.phase = donePhase(f);
    moved.push(f.name);
  }
  save(list);
  const after = counts(load());
  moved.forEach((n) => console.log('  shipped: ' + n));
  console.log('\n' + before.built + ' built · ' + before.todo + ' to do   →   ' +
              after.built + ' built · ' + after.todo + ' to do');
  process.exit(0);
}

if (cmd === 'add') {
  const flags = args.filter((a) => a.startsWith('--'));
  const [name, desc, cat] = args.filter((a) => !a.startsWith('--'));
  if (!name) { console.error('node tools/features.js add "Name" "What it does" ["Category"] [--todo]'); process.exit(1); }
  const todo = flags.includes('--todo');
  const before = counts(list);
  const item = { id: nextId(list), phase: todo ? 'roadmap' : 'inv',
    cat: cat || 'Platform · Refinements', name, desc: desc || '' };
  list.push(item);
  save(list);
  const after = counts(load());
  console.log('  added (' + (todo ? 'to do' : 'built') + '): ' + name + '   id ' + item.id);
  console.log('\n' + before.built + ' built · ' + before.todo + ' to do   →   ' +
              after.built + ' built · ' + after.todo + ' to do');
  process.exit(0);
}

console.error('unknown command: ' + cmd + '\n  (no args) | todo | done <id>… | add "Name" "Desc" ["Cat"] [--todo]');
process.exit(1);
