// reserved-seed.js — curated inventory of "premium" usernames to lock, plus
// generators for short character combos. Locking a name only RESERVES it (nobody
// can register/switch to it); an admin can unlock it, or assign it to a specific
// account, at any time. Anyone who already holds a name keeps it.
//
// Tiers (opt-in from the admin dashboard so the blast radius is a deliberate choice):
//   curated  — brands, public figures, generic high-value words (~hundreds)
//   len1     — every 1-char handle            (a–z, 0–9)                =   36
//   len2     — every 2-char handle                                     = 1,296
//   len3     — every 3-char handle                                     = 46,656
//   len4     — every 4-char handle                                     = 1,679,616  (huge — opt-in with care)
'use strict';

// ── Curated premium names ───────────────────────────────────────────────────
// Impersonation-risk + high-value. Usernames are lowercased; the gate is
// case-insensitive. Keep additions here (one flat, de-duped list).
const BRANDS = [
  'apple', 'google', 'amazon', 'microsoft', 'meta', 'facebook', 'instagram', 'whatsapp',
  'netflix', 'tesla', 'spacex', 'nvidia', 'openai', 'samsung', 'sony', 'intel', 'amd',
  'ibm', 'oracle', 'adobe', 'salesforce', 'uber', 'lyft', 'airbnb', 'spotify', 'twitter',
  'tiktok', 'snapchat', 'youtube', 'telegram', 'discord', 'reddit', 'linkedin', 'pinterest',
  'paypal', 'visa', 'mastercard', 'amex', 'stripe', 'square', 'coinbase', 'binance', 'kraken',
  'walmart', 'target', 'costco', 'ikea', 'nike', 'adidas', 'puma', 'reebok', 'gucci', 'prada',
  'chanel', 'versace', 'rolex', 'disney', 'pixar', 'marvel', 'dc', 'hbo', 'espn', 'cnn', 'bbc',
  'nbc', 'fox', 'starbucks', 'mcdonalds', 'burgerking', 'subway', 'kfc', 'cocacola', 'pepsi',
  'redbull', 'toyota', 'honda', 'ford', 'chevrolet', 'bmw', 'mercedes', 'audi', 'volkswagen',
  'ferrari', 'lamborghini', 'porsche', 'bugatti', 'bentley', 'rollsroyce', 'jeep', 'nissan',
  'hyundai', 'kia', 'volvo', 'boeing', 'airbus', 'nasa', 'spacecraft', 'qualcomm', 'cisco',
  'dell', 'hp', 'lenovo', 'asus', 'acer', 'razer', 'logitech', 'gopro', 'canon', 'nikon',
  'shopify', 'ebay', 'etsy', 'alibaba', 'aliexpress', 'wish', 'doordash', 'grubhub', 'instacart',
  'robinhood', 'venmo', 'cashapp', 'zelle', 'chase', 'wellsfargo', 'citibank', 'hsbc', 'barclays',
  'goldmansachs', 'blackrock', 'vanguard', 'fidelity', 'bloomberg', 'forbes', 'wsj', 'nytimes',
  'google', 'gmail', 'outlook', 'yahoo', 'bing', 'duckduckgo', 'wikipedia', 'twitch', 'steam',
  'playstation', 'xbox', 'nintendo', 'epicgames', 'roblox', 'minecraft', 'fortnite', 'ea',
  'ubisoft', 'activision', 'rockstar', 'valve', 'blizzard', 'zoom', 'slack', 'notion', 'figma',
  'dropbox', 'github', 'gitlab', 'atlassian', 'cloudflare', 'digitalocean', 'aws', 'azure',
];
const PEOPLE = [
  // Entrepreneurs / tech
  'elonmusk', 'musk', 'jeffbezos', 'bezos', 'billgates', 'gates', 'markzuckerberg', 'zuckerberg',
  'warrenbuffett', 'buffett', 'stevejobs', 'timcook', 'sundarpichai', 'satyanadella', 'jensenhuang',
  'samaltman', 'jackdorsey', 'larrypage', 'sergeybrin', 'larryellison', 'michaeldell', 'richardbranson',
  'branson', 'peterthiel', 'marcandreessen', 'chamath', 'garyvee', 'garyvaynerchuk', 'mrbeast',
  // Politicians / leaders
  'obama', 'barackobama', 'michelleobama', 'biden', 'joebiden', 'trump', 'donaldtrump', 'kamalaharris',
  'hillaryclinton', 'billclinton', 'georgebush', 'reagan', 'lincoln', 'washington', 'jfk', 'kennedy',
  'putin', 'zelensky', 'macron', 'merkel', 'modi', 'narendramodi', 'borisjohnson', 'rishisunak',
  'trudeau', 'netanyahu', 'pope', 'popefrancis', 'dalailama', 'churchill', 'mandela', 'gandhi',
  // Athletes
  'ronaldo', 'cristiano', 'messi', 'lionelmessi', 'neymar', 'mbappe', 'lebron', 'lebronjames', 'jordan',
  'michaeljordan', 'kobe', 'kobebryant', 'curry', 'stephcurry', 'brady', 'tombrady', 'serena',
  'serenawilliams', 'federer', 'nadal', 'djokovic', 'tiger', 'tigerwoods', 'usainbolt', 'miketyson',
  'floydmayweather', 'connormcgregor', 'mcgregor',
  // Music / entertainment
  'beyonce', 'jayz', 'drake', 'rihanna', 'taylorswift', 'kanye', 'kanyewest', 'ye', 'adele', 'eminem',
  'justinbieber', 'bieber', 'ladygaga', 'billieeilish', 'theweeknd', 'brunomars', 'edsheeran',
  'arianagrande', 'selenagomez', 'kimkardashian', 'kyliejenner', 'kendalljenner', 'therock',
  'dwaynejohnson', 'willsmith', 'tomcruise', 'leonardodicaprio', 'dicaprio', 'bradpitt', 'oprah',
  'ellen', 'kevinhart', 'snoopdogg', 'snoop', 'cardib', 'nickiminaj', 'travisscott', 'badbunny',
];
const WORDS = [
  // Generic high-value / functional
  'admin', 'root', 'support', 'help', 'info', 'contact', 'official', 'staff', 'team', 'mod',
  'moderator', 'security', 'billing', 'sales', 'press', 'media', 'news', 'app', 'api', 'dev',
  'developer', 'system', 'service', 'account', 'accounts', 'user', 'users', 'me', 'you', 'we',
  'everyone', 'all', 'home', 'about', 'settings', 'login', 'signup', 'auth', 'verify', 'verified',
  // Money / commerce
  'money', 'cash', 'bank', 'pay', 'payments', 'wallet', 'crypto', 'bitcoin', 'btc', 'ethereum', 'eth',
  'nft', 'gold', 'silver', 'diamond', 'rich', 'wealth', 'invest', 'trade', 'trading', 'stocks', 'finance',
  'shop', 'store', 'market', 'buy', 'sell', 'deal', 'deals', 'sale', 'free', 'vip', 'pro', 'plus', 'premium',
  'business', 'brand', 'company', 'agency', 'studio', 'startup', 'ceo', 'founder', 'boss', 'king', 'queen',
  // Culture / lifestyle
  'love', 'life', 'world', 'global', 'earth', 'god', 'music', 'art', 'design', 'photo', 'photography',
  'video', 'film', 'movie', 'movies', 'tv', 'radio', 'live', 'stream', 'gaming', 'game', 'games', 'esports',
  'sports', 'football', 'soccer', 'basketball', 'fitness', 'gym', 'health', 'wellness', 'food', 'travel',
  'fashion', 'beauty', 'style', 'luxury', 'tech', 'ai', 'code', 'coding', 'science', 'space', 'nature',
  'best', 'top', 'hot', 'cool', 'new', 'now', 'the', 'real', 'true', 'one', 'win', 'winner', 'legend',
  'boss', 'chief', 'master', 'guru', 'expert', 'daily', 'weekly', 'today', 'official', 'original',
];

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Every combo of exactly `n` chars over [a-z0-9]. Guardrailed: n>4 is refused
// (len4 alone is already 1.6M; nobody should generate len5 = 60M).
function combos(n) {
  if (n < 1 || n > 4) return [];
  let out = [''];
  for (let i = 0; i < n; i++) {
    const next = [];
    for (const p of out) for (const c of CHARS) next.push(p + c);
    out = next;
  }
  return out;
}

// Build the de-duped, validated lock list for the requested tiers.
// tiers: { curated?:bool, len1?:bool, len2?:bool, len3?:bool, len4?:bool }
function buildReservedList(tiers = {}) {
  const set = new Set();
  const add = (name) => {
    const u = String(name || '').trim().toLowerCase();
    if (u && u.length <= 40 && /^[a-z0-9._-]+$/.test(u)) set.add(u);
  };
  if (tiers.curated) { for (const n of BRANDS) add(n); for (const n of PEOPLE) add(n); for (const n of WORDS) add(n); }
  if (tiers.len1) for (const n of combos(1)) add(n);
  if (tiers.len2) for (const n of combos(2)) add(n);
  if (tiers.len3) for (const n of combos(3)) add(n);
  if (tiers.len4) for (const n of combos(4)) add(n);
  return [...set];
}

// Rough count without materializing the (possibly huge) list.
function estimateCount(tiers = {}) {
  let n = 0;
  if (tiers.curated) n += new Set([...BRANDS, ...PEOPLE, ...WORDS].map((x) => x.toLowerCase())).size;
  if (tiers.len1) n += 36;
  if (tiers.len2) n += 36 ** 2;
  if (tiers.len3) n += 36 ** 3;
  if (tiers.len4) n += 36 ** 4;
  return n;
}

module.exports = { buildReservedList, estimateCount, combos, CURATED_COUNT: new Set([...BRANDS, ...PEOPLE, ...WORDS]).size };
