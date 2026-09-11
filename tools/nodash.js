/* TURN AN EM DASH INTO THE PUNCTUATION IT WAS STANDING IN FOR.
 *
 * The em dash is the single most recognisable tell of machine-written text, and the
 * founder's instruction is that a member must never meet one that Atwe wrote. Replacing
 * it blindly with a hyphen would be worse than leaving it: it reads as a typo rather than
 * as a sentence. So this does what a person editing the line would do, which depends
 * entirely on the job the dash was doing:
 *
 *   A PAIR inside one sentence is a parenthetical aside — "three kinds — a, b, c — and a
 *   fourth" — and the two dashes become two commas, because a full stop there would cut a
 *   sentence in half.
 *
 *   A LONE dash joins a statement to its elaboration ("No open flags — you're clean"),
 *   and that is two sentences wearing one coat: a full stop and a capital letter. Even
 *   when what follows is a fragment ("The everyday default — strong and quick") the full
 *   stop reads as deliberate emphasis, which a comma splice does not.
 *
 *   A dash between two NUMBERS is a range, and ranges take the word "to".
 *
 * Used in two places that must never disagree: the runtime net on everything Atwe AI
 * writes, and the sweep that cleaned the app's own copy.
 */
'use strict';

const DASH = /[—–]/;                       // em dash and en dash
const DASH_G = /[—–]/g;

/* A run of SQL or markup is not prose, and a dash inside one is invisible to everybody.
   Rewriting it can only do harm, so it is left exactly as it is. */
const LOOKS_LIKE_CODE = /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|ALTER TABLE|WITH)\b[\s\S]*\b(FROM|VALUES|SET|WHERE|AS)\b/;

function deDash(s) {
  if (typeof s !== 'string' || !DASH.test(s)) return s;
  if (LOOKS_LIKE_CODE.test(s)) return s;

  /* A LABEL is a trail of crumbs, not a sentence: "Beam \u00b7 Messaging \u2014 core". The app
     already separates those with a middle dot, so the dash becomes one and the label keeps
     reading as a label. A full stop there ("Beam \u00b7 Messaging. Core") is plainly wrong. */
  if (s.length < 60 && /\u00b7/.test(s) && !/[.!?]/.test(s))
    return s.replace(/\s*[—–]\s*/g, ' \u00b7 ');

  /* 1. A dash with NO SPACE around it is never prose punctuation: it is a range or a
        compound. "2–25 segments", "1D–ALL", "Mon–Fri". These take the word "to", and
        catching them first is what stops the sentence rules turning "(1D–ALL)" into
        "(1D. ALL)". Spaced ranges between digits are the same thing written loosely. */
  s = s.replace(/(\w)[—–](\w)/g, '$1 to $2');
  s = s.replace(/(\d)\s*[—–]\s*(\d)/g, '$1 to $2');

  // 2. Parenthetical PAIRS, inside one sentence. Both dashes become commas — and the
  //    trailing one is dropped entirely when a comma already follows, so "a — b — , and"
  //    can never happen.
  /* The middle of a real aside contains no bracket and no separator dot. Without that,
     "canvas chart (1D–ALL), inline cards — optional data" read as one pair spanning the
     bracket and turned a RANGE into a comma: "(1D, ALL)". */
  s = s.replace(/\s*[—–]\s*([^—–.!?()\[\]·|]{1,120}?)\s*[—–]\s*/g,
    (_m, mid) => ', ' + mid.trim() + ', ');

  // 3. A run that is NOTHING BUT a dash is a table's empty cell, not prose. A full stop
  //    there would read as a mistake, so it becomes a plain hyphen: still obviously "no
  //    value", and unmistakably not the long dash.
  if (/^\s*[—–]\s*$/.test(s)) return s.replace(/[—–]/, '-');

  // 4. A LEADING dash is a signature line ("— The Atwe team"). It carries no meaning that
  //    the line break has not already carried, so it simply goes.
  s = s.replace(/^\s*[—–]\s*/, '');

  // 5. Whatever is left is a lone dash joining two halves, and WHICH punctuation it wants
  //    depends on the first word of the second half. A conjunction or a relative pronoun
  //    cannot open a sentence — "X. And Y", "X. Which is why" — so those take a comma and
  //    keep their lower case. Everything else takes the full stop, because the two halves
  //    really are two statements, and a comma between them would be a splice.
  const JOINER = /^(and|but|or|nor|so|yet|which|who|whom|whose|that|because|although|though|while|whereas|since|unless|until|where|when|plus|also|if|as|for|to|with|without|including|like|such)$/i;

  /* 5a. A LIST after the dash is the one case where a colon is plainly better than a full
         stop: "every staff action — who, what, when, target, IP" is introducing its own
         contents, and "Who, what, when, target, IP." as a sentence of its own reads like a
         fragment somebody forgot to finish. Deliberately narrow — it fires only when the
         tail runs to the end and really is a list of two or more — because a colon in front
         of an instruction ("refund: add money first") would be worse than the full stop. */
  s = s.replace(/\s*[—–]\s*([^—–.!?]*,[^—–.!?]*)([.!?]?)\s*$/, (m, tail, end) =>
    (tail.split(',').filter((x) => x.trim()).length >= 2) ? ': ' + tail.trim() + end : m);

  s = s.replace(/\s*[—–]\s*(\S*)/g, (_m, word) => {
    if (!word) return '.';
    if (JOINER.test(word)) return ', ' + word;
    return '. ' + (/[a-z]/.test(word[0]) ? word[0].toUpperCase() + word.slice(1) : word);
  });

  // 4. Tidy the joins this can create.
  /* Tidy ONLY the joins this function can create. It must never reflow whitespace: these
     runs include multi-line SQL, and an earlier version's innocent-looking "collapse runs
     of spaces" rewrote every query in the file into one flat line. Nothing here touches a
     character that was not next to a dash. */
  s = s.replace(/,[ \t]*,/g, ',').replace(/,[ \t]*\./g, '.').replace(/\.[ \t]*\./g, '.')
       .replace(/:[ \t]*\./g, ':').replace(/[ \t]+([,.;:!?])/g, '$1');
  return s;
}

/* A DASH CAN BE WRITTEN WITHOUT BEING A DASH, and that is how twenty of them survived the
   first sweep with every check green. `'—'` in a source file is six plain ASCII bytes,
   so the DASH test above cannot see it, yet the browser turns it straight back into a real
   em dash and paints it on the screen. The offline screen said "Check your connection — we'll
   pick up right where you left off" that way, which is to say the app spoke in exactly the
   voice this whole rule exists to remove, at the one moment a member is already annoyed.
   The same is true of an HTML entity (&mdash;) and of the raw UTF-8 bytes spelled out.

   So a SOURCE sweep must look for the disguises as well as the character. Only text already
   in memory, where the escape has been decoded, can be tested with DASH alone. */
const DASH_SRC = /[—–]|\\u201[34]|\\x[eE]2\\x80\\x9[34]|&mdash;|&ndash;|&#8212;|&#8211;|&#x201[34];?/;

/* WHY CODE COMMENTS ARE DELIBERATELY LEFT ALONE, so nobody has to find this out twice.
   About 3,900 dashes live in comments and SQL notes. Nobody can see one: a comment is not
   sent to the model, not rendered by the browser, and not read by Postgres. Removing them
   anyway was tried, mechanically, with the rewrite proved not to touch a single byte of
   real code or move a single line. It still had to be thrown away, because the output was
   worse than the input: "as — .pf-top-save" became "as.pf-top-save", "than — .overlay"
   became "than.overlay", and "and — :root is a different element" became "and:root", which
   reads as a selector. A dash standing in front of a class name, a selector or a bracket is
   not punctuation a machine can replace, and these comments are the only written record of
   why half this app is built the way it is. The guard (scratchpad/nodash.js) is what makes
   the rule stick; sweeping the margin notes was never what was protecting anybody. */

const hasDash = (s) => typeof s === 'string' && DASH.test(s);
/* For a run lifted straight out of a source file, before any escape has been decoded. */
const hasDashSrc = (s) => typeof s === 'string' && DASH_SRC.test(s);
module.exports = { deDash, hasDash, hasDashSrc, DASH, DASH_G, DASH_SRC };
