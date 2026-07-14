// ─────────────────────────────────────────────────────────────────────────────
// Feature Controls catalog — the admin kill-switch surface.
//
// Big-company pattern (LaunchDarkly / Unleash / Meta Gatekeeper): operational
// kill switches live at the MODULE level, not per micro-feature. Each entry here
// is a feature a user reaches through a clear entry point (a menu tile, a hub
// row, a world tab). An admin can deactivate any of them; the client then shows
// an "Unavailable" screen when a user opens it, and the server refuses the
// money-critical ones.
//
// `key`   stable id used in code gates + stored state (NEVER rename once shipped)
// `label` what the admin sees
// `cat`   grouping in the admin UI
// Every feature defaults to ON (available); it is only off when explicitly set.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = [
  // ── Money & Wallet ──
  { key: 'wallet',            label: 'Wallet',                 cat: 'Money & Wallet' },
  { key: 'send_money',        label: 'Send money',             cat: 'Money & Wallet' },
  { key: 'money_requests',    label: 'Money requests',         cat: 'Money & Wallet' },
  { key: 'cashout',           label: 'Cash out to bank',       cat: 'Money & Wallet' },
  { key: 'savings_pots',      label: 'Savings pots',           cat: 'Money & Wallet' },
  { key: 'split_bills',       label: 'Split a bill',           cat: 'Money & Wallet' },
  { key: 'money_pools',       label: 'Money pools',            cat: 'Money & Wallet' },
  { key: 'scheduled_payments',label: 'Scheduled payments',     cat: 'Money & Wallet' },
  { key: 'payment_links',     label: 'Payment links',          cat: 'Money & Wallet' },
  { key: 'gift_cards',        label: 'Gift cards',             cat: 'Money & Wallet' },
  { key: 'invoices',          label: 'Invoices',               cat: 'Money & Wallet' },
  { key: 'quotes',            label: 'Quotes & estimates',     cat: 'Money & Wallet' },
  { key: 'tips',              label: 'Tips',                   cat: 'Money & Wallet' },
  { key: 'loyalty',           label: 'Loyalty & rewards',      cat: 'Money & Wallet' },
  { key: 'referrals',         label: 'Referral program',      cat: 'Money & Wallet' },
  { key: 'atwe_card',         label: 'Atwe Card',              cat: 'Money & Wallet' },

  // ── Marketplace & Commerce ──
  { key: 'marketplace',       label: 'Marketplace & listings', cat: 'Marketplace & Commerce' },
  { key: 'cart_checkout',     label: 'Cart & checkout',        cat: 'Marketplace & Commerce' },
  { key: 'buy_now',           label: 'Buy now',                cat: 'Marketplace & Commerce' },
  { key: 'offers',            label: 'Make an offer',          cat: 'Marketplace & Commerce' },
  { key: 'escrow',            label: 'Escrow / buyer protection', cat: 'Marketplace & Commerce' },
  { key: 'orders',            label: 'Orders',                 cat: 'Marketplace & Commerce' },
  { key: 'shipping_labels',   label: 'Shipping labels',        cat: 'Marketplace & Commerce' },
  { key: 'returns',           label: 'Returns / RMA',          cat: 'Marketplace & Commerce' },
  { key: 'product_reviews',   label: 'Product reviews',        cat: 'Marketplace & Commerce' },
  { key: 'coupons',           label: 'Coupons',                cat: 'Marketplace & Commerce' },
  { key: 'bundles',           label: 'Bundles',                cat: 'Marketplace & Commerce' },
  { key: 'subscribe_save',    label: 'Subscribe & Save',       cat: 'Marketplace & Commerce' },
  { key: 'wishlist',          label: 'Wishlist',               cat: 'Marketplace & Commerce' },
  { key: 'rentals',           label: 'Rentals',                cat: 'Marketplace & Commerce' },
  { key: 'storefronts',       label: 'Storefronts',            cat: 'Marketplace & Commerce' },
  { key: 'sell',              label: 'Selling / my listings',  cat: 'Marketplace & Commerce' },
  { key: 'seller_analytics',  label: 'Sales & analytics',      cat: 'Marketplace & Commerce' },

  // ── Jobs & Hiring ──
  { key: 'jobs',              label: 'Jobs board',             cat: 'Jobs & Hiring' },
  { key: 'apply',             label: 'Apply to jobs',          cat: 'Jobs & Hiring' },
  { key: 'post_job',          label: 'Post a job',             cat: 'Jobs & Hiring' },
  { key: 'applicants',        label: 'Applicant pipeline',     cat: 'Jobs & Hiring' },
  { key: 'open_to_work',      label: 'Open to work',           cat: 'Jobs & Hiring' },
  { key: 'saved_candidates',  label: 'Saved candidates',       cat: 'Jobs & Hiring' },
  { key: 'ai_matchmaker',     label: 'AI job matchmaker',      cat: 'Jobs & Hiring' },
  { key: 'resumes',           label: 'AI resumes',             cat: 'Jobs & Hiring' },

  // ── Services, Bookings & Events ──
  { key: 'services',          label: 'Services directory',     cat: 'Services, Bookings & Events' },
  { key: 'appointments',      label: 'Appointments & booking', cat: 'Services, Bookings & Events' },
  { key: 'events',            label: 'Events',                 cat: 'Services, Bookings & Events' },
  { key: 'courses',           label: 'Courses',                cat: 'Services, Bookings & Events' },
  { key: 'newsletters',       label: 'Newsletters',            cat: 'Services, Bookings & Events' },
  { key: 'agenda',            label: 'Calendar / agenda',      cat: 'Services, Bookings & Events' },
  { key: 'business_qa',       label: 'Business Q&A',           cat: 'Services, Bookings & Events' },
  { key: 'team',              label: 'Team / multi-seat',      cat: 'Services, Bookings & Events' },
  { key: 'dashboard',         label: 'Owner dashboard',        cat: 'Services, Bookings & Events' },

  // ── Messaging (Beam) ──
  { key: 'messaging',         label: 'Direct messages',        cat: 'Messaging (Beam)' },
  { key: 'groups',            label: 'Groups',                 cat: 'Messaging (Beam)' },
  { key: 'channels',          label: 'Channels',               cat: 'Messaging (Beam)' },
  { key: 'communities',       label: 'Communities',            cat: 'Messaging (Beam)' },
  { key: 'broadcast_lists',   label: 'Broadcast lists',        cat: 'Messaging (Beam)' },
  { key: 'voice_notes',       label: 'Voice notes',            cat: 'Messaging (Beam)' },
  { key: 'disappearing',      label: 'Disappearing messages',  cat: 'Messaging (Beam)' },
  { key: 'view_once',         label: 'View-once media',        cat: 'Messaging (Beam)' },
  { key: 'locked_chats',      label: 'Locked chats',           cat: 'Messaging (Beam)' },
  { key: 'scheduled_messages',label: 'Scheduled messages',     cat: 'Messaging (Beam)' },
  { key: 'live_location',     label: 'Live location',          cat: 'Messaging (Beam)' },
  { key: 'group_cloud',       label: 'Group Cloud',            cat: 'Messaging (Beam)' },
  { key: 'stickers_gifs',     label: 'Stickers & GIFs',        cat: 'Messaging (Beam)' },
  { key: 'auto_messages',     label: 'Business auto-messages', cat: 'Messaging (Beam)' },

  // ── Calls & Live ──
  { key: 'calls',             label: 'Voice & video calls',    cat: 'Calls & Live' },
  { key: 'group_calls',       label: 'Group calls',            cat: 'Calls & Live' },
  { key: 'call_links',        label: 'Call links',             cat: 'Calls & Live' },
  { key: 'screen_share',      label: 'Screen share',           cat: 'Calls & Live' },
  { key: 'go_live',           label: 'Go Live',                cat: 'Calls & Live' },
  { key: 'spaces',            label: 'Spaces (audio rooms)',   cat: 'Calls & Live' },
  { key: 'live_shopping',     label: 'Live shopping',          cat: 'Calls & Live' },

  // ── Posts & Content ──
  { key: 'posting',           label: 'Post composer',          cat: 'Posts & Content' },
  { key: 'reels',             label: 'Reels / shorts',         cat: 'Posts & Content' },
  { key: 'polls',             label: 'Polls',                  cat: 'Posts & Content' },
  { key: 'bookmarks',         label: 'Bookmarks & collections',cat: 'Posts & Content' },
  { key: 'scheduled_posts',   label: 'Scheduled posts',        cat: 'Posts & Content' },
  { key: 'lists',             label: 'Lists',                  cat: 'Posts & Content' },
  { key: 'cashtags',          label: 'Cashtags & market data', cat: 'Posts & Content' },

  // ── Stories ──
  { key: 'stories',           label: 'Stories',                cat: 'Stories' },
  { key: 'close_friends',     label: 'Close Friends',          cat: 'Stories' },
  { key: 'highlights',        label: 'Story highlights',       cat: 'Stories' },

  // ── Social graph ──
  { key: 'connections',       label: 'Connections',            cat: 'Social & Network' },
  { key: 'skills',            label: 'Skills & endorsements',  cat: 'Social & Network' },
  { key: 'recommendations',   label: 'Recommendations',        cat: 'Social & Network' },
  { key: 'profile_views',     label: 'Who viewed my profile',  cat: 'Social & Network' },
  { key: 'showcase',          label: 'Showcase / portfolio',   cat: 'Social & Network' },
  { key: 'contacts',          label: 'Contact book',           cat: 'Social & Network' },

  // ── Discovery ──
  { key: 'search',            label: 'Search',                 cat: 'Discovery' },
  { key: 'circles',           label: 'Industry circles',       cat: 'Discovery' },
  { key: 'business_directory',label: 'Business directory',     cat: 'Discovery' },
  { key: 'near_me',           label: 'Near-me discovery',      cat: 'Discovery' },

  // ── Creator & Ads ──
  { key: 'creator_subs',      label: 'Creator subscriptions',  cat: 'Creator & Ads' },
  { key: 'ppv',               label: 'Pay-per-view posts',     cat: 'Creator & Ads' },
  { key: 'promoted_posts',    label: 'Promoted posts',         cat: 'Creator & Ads' },
  { key: 'atwe_ads',          label: 'Atwe Ads',               cat: 'Creator & Ads' },
  { key: 'ads_manager',       label: 'Ads Manager',            cat: 'Creator & Ads' },
  { key: 'affiliate',         label: 'Affiliate program',      cat: 'Creator & Ads' },

  // ── Atwe AI ──
  { key: 'ai',                label: 'Atwe AI assistant',      cat: 'Atwe AI' },
  { key: 'ai_write',          label: 'AI writing copilot',     cat: 'Atwe AI' },
  { key: 'ai_shopping',       label: 'AI shopping concierge',  cat: 'Atwe AI' },
  { key: 'ai_agent',          label: 'AI agent (do it for me)',cat: 'Atwe AI' },

  // ── Account & Safety ──
  { key: 'signups',           label: 'New sign-ups',           cat: 'Account & Safety' },
  { key: 'stt',               label: 'Voice transcription',    cat: 'Account & Safety' },
  { key: 'reporting',         label: 'Reporting',              cat: 'Account & Safety' },
  { key: 'data_export',       label: 'Data export',            cat: 'Account & Safety' },
];
