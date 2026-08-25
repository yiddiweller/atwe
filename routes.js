/* Atwe's system routes — the words that are real addresses on atwe.com and can
   therefore never be registered as a username.
 *
 * A person's public identity is atwe.com/<username>, so /settings must always be
 * the Settings page and never a member called "settings". This list is what makes
 * that true, and it is enforced in two places:
 *   · signup + username-change go through usernameReserved(), which reads the
 *     reserved_usernames table — seeded from this list on every boot;
 *   · the client router refuses to treat any of these as a handle.
 *
 * The client's own copy lives in public/index.html as RESERVED_PATHS, generated
 * from its APP_ROUTES table. There is no build step, so the two cannot literally
 * share a module — instead test/routes.test.js fails if they ever drift apart.
 * Add a new route in BOTH places, or the test will tell you.
 */
const SYSTEM_ROUTES = [
  'about', 'account', 'addresses', 'admin', 'admin.html', 'ads', 'affiliate', 'ai',
  'analytics', 'api', 'appointments', 'assets', 'atwe', 'atwe-ai', 'atweai', 'auth', 'beam',
  'billing', 'blog', 'bookings', 'business', 'businesses', 'calendar', 'careers', 'cart',
  'cdn', 'checkout', 'circle', 'collections', 'communities', 'companies', 'company', 'confirm',
  'contact', 'cookies', 'courses', 'dashboard', 'delete', 'devices', 'download', 'edit',
  'engine', 'event', 'events', 'false', 'favicon.ico', 'favicon.png', 'feed', 'files',
  'forgot-password', 'gift-cards', 'group', 'help', 'home', 'index.html', 'invite', 'invoices',
  'job', 'job-alerts', 'jobs', 'legal', 'listing', 'listings', 'locked.html', 'login',
  'logout', 'manifest.json', 'manifest.webmanifest', 'marketplace', 'me', 'media', 'messages',
  'money-requests', 'network', 'new', 'newsletters', 'notifications', 'null', 'oauth',
  'official', 'orders', 'org', 'organization', 'page', 'pages', 'password', 'pay',
  'payment-links', 'plans', 'post', 'premium', 'press', 'pricing', 'privacy', 'privacy-policy',
  'pro', 'profile', 'public', 'quotes', 'referrals', 'register', 'reset-password', 'resumes',
  'rewards', 'robots.txt', 'root', 'saved', 'search', 'security', 'services', 'settings',
  'showcase', 'signin', 'signout', 'signup', 'sitemap.xml', 'sso', 'staff', 'static', 'status',
  'store', 'subscriptions', 'support', 'sw.js', 'system', 'team', 'terms', 'terms-of-service',
  'true', 'undefined', 'upgrade', 'verify', 'verify-email', 'wallet', 'welcome', 'you'
];

module.exports = { SYSTEM_ROUTES };
