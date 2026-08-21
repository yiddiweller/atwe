/* ═══════════════════════════════════════════════════════════════════════════
   BLOCKLIST  —  the starter word and phrase list Atwe ships with
   ───────────────────────────────────────────────────────────────────────────
   A hit on this list REFUSES the post outright, so the bar for inclusion is
   high: a term earns its place only if there is essentially no honest business
   reason to write it. Over-blocking is a real cost — it stops a legitimate
   seller mid-sentence with no idea why.

   This is deliberately NOT an attempt at a complete hate-speech filter. That
   job belongs to Atwe AI moderation, which reads meaning rather than matching
   strings and catches harassment, threats and abuse this list never could.
   What is here is the narrow set of cases worth refusing before anything else
   runs: the clearest slurs, and the scam phrasing that costs members money.

   Seeded ONCE, and only into a completely empty blocklist. The moment the
   owner saves their own list — even an empty one — this stops being consulted.
   Edit it in the dashboard under Site, then Safety tools.

   The matcher (see blockedContentReason in server.js) treats a single word as
   a whole word, so "ass" never matches "grass". A phrase containing a space is
   matched as a substring, which is why every phrase below is long enough to be
   unambiguous on its own.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

// Scam and fraud phrasing. These are what actually take money off members —
// each one is a full phrase, chosen so it cannot appear in an honest listing.
const SCAM_PHRASES = [
  'guaranteed returns',
  'guaranteed profit',
  'double your money',
  'risk free investment',
  'get rich quick',
  'send me the money first',
  'pay with gift cards only',
  'gift card only payment',
  'western union only',
  'wire the money first',
  'send crypto to this address',
  'bitcoin doubler',
  'crypto doubler',
  'investment opportunity dm me',
  'i can recover your lost funds',
  'recover your stolen crypto',
  'binary options signals',
  'forex signals guaranteed',
  'work from home no experience earn',
  'make money fast dm me',
  'i will multiply your money',
  'flash funds',
  'clone card',
  'cloned cards',
  'cvv fullz',
  'bank logs for sale',
  'verified paypal accounts for sale',
  'money flip',
  'legit money flipper',
];

// Impersonating Atwe itself. Nobody from Atwe ever asks for these, so anyone
// writing them to a member is running the single most common account theft.
const IMPERSONATION_PHRASES = [
  'atwe support will never',        // keeps the phrase out of phishing copy
  'send me your password',
  'send me your verification code',
  'share your 2fa code',
  'give me your one time code',
  'confirm your account password',
];

// Slurs. The narrow set with no legitimate use and no realistic false
// positive under whole-word matching. Not a complete list, and not meant to
// be — Atwe AI moderation is what actually covers hate speech.
const SLURS = [
  'nigger', 'niggers', 'nigga',
  'faggot', 'faggots',
  'kike', 'kikes',
  'spic', 'spics',
  'chink', 'chinks',
  'wetback', 'wetbacks',
  'tranny', 'trannies',
  'retard', 'retards', 'retarded',
];

// Sexual content involving minors. Zero tolerance, and none of these strings
// has any other reading.
const CSAM_PHRASES = [
  'child porn',
  'cp for sale',
  'underage nudes',
  'loli porn',
];

const BLOCK_TERMS = [...SCAM_PHRASES, ...IMPERSONATION_PHRASES, ...SLURS, ...CSAM_PHRASES];

// Link domains worth refusing outright: URL shorteners, which exist to hide
// where a link actually goes and are the standard wrapper for a scam link.
// Deliberately short — blocking a real domain by mistake breaks honest posts.
const BLOCK_DOMAINS = [
  'bit.ly', 'tinyurl.com', 'is.gd', 'cutt.ly', 'shorturl.at',
  'rebrand.ly', 'ow.ly', 't.ly', 'rb.gy', 'shorte.st',
];

module.exports = { BLOCK_TERMS, BLOCK_DOMAINS };
