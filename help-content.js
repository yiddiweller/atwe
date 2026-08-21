/* ═══════════════════════════════════════════════════════════════════════════
   HELP CENTRE  —  the starter articles Atwe ships with
   ───────────────────────────────────────────────────────────────────────────
   An empty help centre isn't neutral: every question a member can't answer for
   themselves becomes a support message somebody has to write back to. So the
   product ships with the answers already in it.

   These are SEEDED ONCE, and only into a help centre that is completely empty
   (see seedHelpArticles in server.js). The moment anyone writes, edits or
   deletes an article, this file stops being consulted — the owner's help centre
   is theirs, not something a deploy overwrites.

   Voice: plain, calm, second person. Say what the member does and what happens.
   No exclamation marks, no emoji, no "simply". Never name the AI vendor —
   the assistant is "Atwe AI".

   Body text is rendered with white-space:pre-wrap, so blank lines and single
   line breaks appear exactly as written here. No markdown.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const HELP_ARTICLES = [
  /* ─────────────────────────── Getting started ─────────────────────────── */
  {
    slug: 'what-is-atwe',
    category: 'Getting started',
    title: 'What Atwe is',
    body: `Atwe is one app for the working side of your life.

You can talk to people, buy and sell, get paid, find work or hire for it, and ask Atwe AI for help with any of it. It is built around five places, along the bar at the bottom of the screen.

Home is your feed — posts from people and businesses you follow, and things Atwe thinks you'll want to see.

Beam is messaging. Direct messages, group chats, voice notes, photos, and voice and video calls.

Engine is for finding things. People, businesses, jobs, products, services, events and courses.

Atwe AI is the assistant. Ask it to write something, find something, or explain something.

Account is everything that belongs to you — your wallet, your orders, your listings, your applications, your settings.

You need an account to use Atwe. There is no browsing without signing in, apart from a single public profile someone shares with you.`,
  },
  {
    slug: 'personal-or-business',
    category: 'Getting started',
    title: 'Personal or business account',
    body: `When you sign up, Atwe asks whether the account is for you personally or for a business. It matters, so it is worth a moment's thought.

A personal account is a person. You can do almost everything: post, message, buy, sell, apply for jobs, offer a service, take payments.

A business account is the business itself. There is no separate company page — the account is the business. On top of everything a personal account does, a business can:

- Post jobs and manage applicants
- Show opening hours and answer public questions
- Take bookings and appointments
- Run a storefront with sections, coupons and bundles
- Apply for the verified business seal
- Invite staff onto the account with their own permissions

A business account's picture appears as a rounded square rather than a circle. That is the one visual difference, and it is how people tell a business from a person at a glance.

You choose once at signup. If you picked wrong, contact support and we'll switch it.`,
  },
  {
    slug: 'your-username',
    category: 'Getting started',
    title: 'Your @username',
    body: `Your username is how people find you and send you money. It appears as @yourname.

You can change it in Account, then Edit profile. Changing it frees your old username for someone else, so anyone with a link to your old profile will not find you at that address any more.

Some usernames are reserved and cannot be taken — short ones, brand names and well-known names. Occasionally one is offered for sale, and you'll see a price when you try it.

Usernames are not case sensitive. @Sarah and @sarah are the same account.`,
  },
  {
    slug: 'finding-your-way',
    category: 'Getting started',
    title: 'Finding your way around',
    body: `A few things that are easy to miss.

Press and hold a message to reply to it, react, forward it, or delete it.

Swipe left on a chat in your list to delete it. Swipe right to mark it unread.

Tap the time on a post to see the exact date it was written.

Tap someone's picture in a chat to open their contact card. Tap their name to open their full profile.

The three dots in the corner of most screens hold the extra actions — search within a chat, export it, mute it, set messages to disappear.

Pull down on a list to refresh it.`,
  },

  /* ────────────────────────────── Buying ───────────────────────────────── */
  {
    slug: 'how-to-buy',
    category: 'Buying',
    title: 'Buying something',
    body: `You can buy from any Atwe seller, whether they're a business or a person.

Open the listing and choose Buy now, or add it to your cart and check out later. Your cart is grouped by seller, so you check out with one seller at a time.

At checkout you pick where it's going, choose how to pay, and see the full total before you confirm — the item, any discount, shipping and tax, all listed separately. Nothing is added after you tap pay.

You can pay from your Atwe balance, with a gift card, or by card. If you have a gift card it is used first and your balance covers the rest.

If the seller offers collection instead of delivery, you'll see a Ship or Local pickup choice. Collection skips the address and the shipping cost.

After you pay, the order appears in Account, then Orders. The seller gets a message with the order in it, so you can talk to them there about anything.`,
  },
  {
    slug: 'buyer-protection',
    category: 'Buying',
    title: 'Buying with protection',
    body: `On most listings you'll see a Buy with protection option next to the normal buy button. It is worth understanding, because it is the safest way to buy from someone you don't know.

With protection, your money does not go to the seller when you pay. Atwe holds it. The seller can see the order is real and paid for, so they'll send your item, but they cannot spend the money yet.

When your item arrives and you're happy with it, you tap Confirm and the money is released to the seller.

If something is wrong, you open a dispute instead. The money stays held while it is looked at, and Atwe decides whether it goes back to you or on to the seller.

If you never confirm and never dispute, the money is released to the seller automatically after seven days. That is deliberate — otherwise an honest seller could be left waiting forever by a buyer who simply forgot.

Protection is paid from your Atwe balance, so you may need to add money first.`,
  },
  {
    slug: 'where-is-my-order',
    category: 'Buying',
    title: 'Where your order is',
    body: `Open Account, then Orders, and tap the order.

You'll see a timeline: Ordered, Paid, Shipped, Delivered. When the seller posts your item, the carrier and tracking number appear, and the tracking number links straight through to the carrier's own tracking page.

If the seller bought the postage label through Atwe, delivery marks itself the moment the carrier reports it. Otherwise, tap I've received it when it arrives.

You'll get a notification at each step, and an email if you have email notifications on.

If it has been a while and nothing has moved, message the seller. The order card in your chat with them opens straight back to the order.`,
  },
  {
    slug: 'returns-and-refunds',
    category: 'Buying',
    title: 'Returns and refunds',
    body: `There are two different things here, and which one you want depends on who you are asking.

To return something to a seller, open the order and tap Request a return, then say why. The seller approves or declines it. If they approve, you are refunded straight away — the money goes back to your Atwe balance. If they use Atwe for postage, they can also send you a prepaid return label, which arrives by email and appears on the order.

To ask Atwe for a refund — for something you paid Atwe for directly, like an advert or a boost, or an order that went wrong — open Account, then Help and refunds. You'll see the payments you can ask about, and you pick the one you mean. Every request is read by a person.

One thing to be honest about: money you sent directly to another member is not automatically clawed back. It is in their balance and they may have spent it. If you sent money to the wrong person, open the payment and tap Ask for it back — that asks them to return it. It does not take it from them.`,
  },
  {
    slug: 'saving-and-alerts',
    category: 'Buying',
    title: 'Saving things and being told when they change',
    body: `Tap the heart on any listing to save it. Saved items live in Account, then Saved items.

Saving does more than remember it. If the seller drops the price, you are told. If it sells out and comes back in stock, you are told.

You can also save a search. Search the marketplace for what you want, then tap Save this search. When somebody lists something that matches, you get a notification.

Both live in Account and can be turned off there or in your notification settings.`,
  },

  /* ────────────────────────────── Selling ──────────────────────────────── */
  {
    slug: 'start-selling',
    category: 'Selling',
    title: 'Selling on Atwe',
    body: `Anyone with a username can sell. You do not need a business account.

Open Account, then My listings, and add one. You'll need a name, a price and at least one photo. Then choose what kind of thing it is:

Physical — something you post. You set the shipping cost, or mark it free, and you can offer local collection.
Digital — a file, a link or a licence key. Atwe delivers it automatically the second the buyer pays.
Service — something you do. There's no checkout; the buyer messages you.
Rental — something priced per night, day, week or month, booked by date.

You can add sizes or colours as variants, each with its own price and stock. Set stock to keep yourself from overselling; leave it blank if you never run out.

Business accounts also get a storefront on their profile, and can group listings into sections — Starters, Mains, Drinks for a menu, or collections for a shop.

Atwe keeps 1% of each completed sale, taken from your side when you're paid. It is never added on top of your price, so what you list is what the buyer pays.`,
  },
  {
    slug: 'getting-paid-as-a-seller',
    category: 'Selling',
    title: 'Getting paid for what you sell',
    body: `When a buyer pays, the money lands in your Atwe balance. You'll see it in your wallet straight away, alongside a line showing the 1% Atwe fee, so it is always clear what came off.

If the buyer chose protection, the money is held until they confirm the item arrived, or for seven days, whichever comes first. You'll see the order marked as protected while that's happening.

From your balance you can spend anywhere on Atwe, or move it to your bank. Open your wallet and tap Cash out to bank. The first time, you'll connect a bank account, which takes a few minutes and asks for the details any bank would.

Large cash-outs are held briefly for a person to look at before they go out. That is a fraud precaution, not a judgement about you.`,
  },
  {
    slug: 'shipping-what-you-sell',
    category: 'Selling',
    title: 'Posting what you sell',
    body: `When an order comes in, open it in Account, then Orders, on the Selling side.

Print the packing slip if it helps — it lists what to put in the box and where it's going.

Then either buy a postage label right there in the app, if Atwe is set up for labels, or post it yourself and type in the carrier and tracking number. Either way the buyer is told immediately and gets a tracking link.

If you buy the label through Atwe, the cost comes out of your balance and delivery is detected automatically when the carrier reports it. If you posted it yourself, either of you can mark it delivered.

Set your shipping cost on each listing — free, or a flat fee. If you'd rather hand things over in person, turn on local collection and say where.`,
  },
  {
    slug: 'coupons-and-offers',
    category: 'Selling',
    title: 'Discounts, offers and bundles',
    body: `Four different tools, for four different situations.

Coupons are codes a buyer types at checkout. Set them up in Manage store, then Coupons. You choose a percentage or a fixed amount, a minimum order if you want one, how many times it can be used, and when it expires. Each buyer can use a code once.

Offers work the other way round — a buyer proposes a price on your listing and you accept, decline, or counter. Turn them off by simply declining; they cost you nothing to receive.

Bundles group several of your own items into one saver pack at a single price. The saving shows on the bundle page.

Subscribe and Save offers a discount to buyers who want the same thing delivered regularly. You choose the discount; they choose how often.`,
  },
  {
    slug: 'sponsored-listings',
    category: 'Selling',
    title: 'Getting your listing seen',
    body: `The marketplace orders results by how well they match, how well the item is rated, how well it sells, and how new it is. A new listing gets a temporary boost so it has a fair chance of being found.

If you want more than that, you can advertise. Tap Advertise next to any of your listings.

You set the most you're willing to pay for a click, and the most you'll spend in a day. Your listing then competes for the sponsored slots at the top of search. You are only charged when someone actually clicks — never for being shown.

You will not be charged your maximum. You pay only enough to beat the next advertiser, so bidding your real maximum never costs you your real maximum.

Your daily budget is spread across the day rather than spent in the first ten minutes, and campaigns pause themselves rather than take you into the red.

Sponsored listings are always labelled Sponsored. Buyers can see they are ads.`,
  },

  /* ─────────────────────────────── Money ───────────────────────────────── */
  {
    slug: 'your-wallet',
    category: 'Money',
    title: 'Your wallet',
    body: `Every Atwe account has a balance. It is real money and it works across the whole app.

Add money adds to your balance from a card.
Send moves money to any @username, instantly and free.
Request asks someone to pay you. Money only moves when they tap Pay.
Cash out moves your balance to your bank account.

You can spend your balance on anything in Atwe — an order, a course, a booking, a ticket, a tip.

Pots are sub-balances for saving towards something. Money in a pot is still yours but is kept out of your spendable balance, so you don't spend it by accident.

There are limits on how much can leave a wallet in a day and in a week. They exist to limit the damage if someone ever gets into your account.`,
  },
  {
    slug: 'sending-money-safely',
    category: 'Money',
    title: 'Sending money safely',
    body: `Sending money on Atwe is instant, and instant means final. Treat it like handing over cash.

Check the @username before you send. Not the display name — anyone can call themselves anything. The @username is the account.

If you send to the wrong person, open the payment and tap Ask for it back. That sends them a request to return it. It does not take the money back, because by then it is in their balance and may be gone.

Nobody at Atwe will ever ask you to send them money, or ask for your password or a code from your authenticator app. If someone claiming to be Atwe support asks you for any of that, they are not from Atwe. Report them.

If you are buying something from someone you don't know, use Buy with protection instead of sending money directly. That is exactly what it is for.`,
  },
  {
    slug: 'gift-cards',
    category: 'Money',
    title: 'Gift cards',
    body: `A gift card is separate from your balance. Buying one takes money from your balance and puts it on the card.

You can send a card to someone by @username, or buy one and share the code. Whoever has it adds it to their own cards, and from then on it's theirs.

Spend a gift card at checkout by choosing it as your payment method. If it doesn't cover the whole order, your balance covers the rest.

You can also move a card's value into your balance, in part or in full, if you'd rather have it as ordinary money.

Cards do not expire. If one is ever put on hold because of a problem with how it was bought, you'll see it marked On hold and the money stays on it while that is sorted out.`,
  },
  {
    slug: 'atwe-fee',
    category: 'Money',
    title: 'What Atwe charges',
    body: `Atwe keeps 1% of each completed marketplace sale. It comes off the seller's side when they are paid — it is never added on top of the price, so a listed price is the price the buyer pays.

You'll see it as a line in your wallet reading "Atwe fee" against the order it relates to, so it is never an unexplained gap.

Sending money to another member is free. Requesting money is free. Adding money and cashing out are free.

Some optional things are paid: advertising a post, boosting a job, sponsoring a listing, featuring a business. You always see the price before you commit, and nothing renews without you knowing.`,
  },

  /* ────────────────────────── Messaging and calls ──────────────────────── */
  {
    slug: 'messages-privacy',
    category: 'Messaging',
    title: 'How private your messages are',
    body: `We would rather tell you exactly how this works than hide behind a word.

Your messages are encrypted while they travel between your phone and Atwe, so nobody on your network can read them. They are stored on Atwe's servers, which is what lets your history appear on a new phone when you sign in.

They are not end-to-end encrypted. We are not going to claim otherwise. Your messages are private to your conversation and are never sold or used to target advertising, but they are stored in a form Atwe holds.

There are things you can do if a conversation needs more than that:

Disappearing messages delete themselves after a day, a week or three months.
View once sends a photo or video that can be opened a single time.
Locked chats are hidden from your chat list behind a passcode.
Advanced privacy on a chat blocks exporting and saving from it.

Group and channel messages can be reviewed by Atwe's moderation when something is reported. One-to-one messages are not.`,
  },
  {
    slug: 'calls',
    category: 'Messaging',
    title: 'Voice and video calls',
    body: `Tap the phone or camera icon at the top of any chat to call.

Group calls work up to eight people. You can also create a call link and share it with anyone — they don't need to be a contact or in a group with you.

If a call rings but you hear nothing, or the screen stays black, that is almost always the network rather than the app. Try switching between wi-fi and mobile data.

You can stop calls from people you don't know. In Privacy and safety, turn on Silence unknown callers. Those calls don't ring — they appear in your call list marked Silenced, so you still know they happened.

Calls you miss, decline or silence all appear on the Calls tab in Beam.`,
  },

  /* ────────────────────────────── Work ─────────────────────────────────── */
  {
    slug: 'finding-work',
    category: 'Work',
    title: 'Finding work',
    body: `Open Engine and tap Jobs. Filter by what you do, where you are, whether it's remote, and what it pays.

On any job, How you match scores you against it and tells you which of your skills to lead with. Prep for the interview gives you the questions you're likely to be asked.

Applying attaches a resume and a short note. Atwe AI can write the note from your profile and the job — read it before you send it.

Track everything you've applied for in Account, then My applications. The status updates as the employer moves you through: reviewed, shortlisted, hired.

Set up job alerts so new matches find you instead of the other way round. And turn on Open to work in Account so employers browsing for people can see you're available — you choose whether that's visible to everyone or only shows up in employer searches.`,
  },
  {
    slug: 'hiring',
    category: 'Work',
    title: 'Hiring someone',
    body: `Post a job from Account, then Post a job. A business account can have three open jobs at once for free; more than that needs Atwe Pro.

Add screening questions to your post — yes or no, a number, or a short answer. Mark the ones that really matter as required, and applicants who don't meet them are flagged for you automatically.

Applicants arrive in a pipeline: applied, reviewed, shortlisted, hired or rejected. Moving someone tells them, so they're not left wondering.

Rank applicants has Atwe AI read every application and order them by fit, with a line explaining each. It never rejects anyone — it only sorts.

Insights on your job shows how many people saw it, how many applied, and how your pay compares with similar roles.

If a job isn't getting seen, you can boost it to the top for thirty days.`,
  },

  /* ─────────────────────────── Safety and account ──────────────────────── */
  {
    slug: 'staying-safe',
    category: 'Safety',
    title: 'Staying safe on Atwe',
    body: `Most people here are exactly who they say they are. These are the habits that protect you from the ones who aren't.

Nobody from Atwe will ever ask for your password, or for a code from your authenticator app or your text messages. Not support, not by email, not on a call. Anyone who does is not from Atwe.

Be careful of anyone who wants to move the conversation off Atwe straight away, especially where money is involved. Once you're off Atwe, none of the protection here applies.

When buying from someone you don't know, use Buy with protection. Your money is held until you have the item.

Be suspicious of a deal that is far better than everything around it, of pressure to decide quickly, and of anyone asking to be paid in a way that can't be reversed.

Check the @username, not the display name.

If something feels wrong, it costs you nothing to walk away.`,
  },
  {
    slug: 'blocking-and-reporting',
    category: 'Safety',
    title: 'Blocking, muting and reporting',
    body: `Three different tools, and it's worth knowing which you want.

Muting is silent and only affects you. A muted account stays followed and never knows — you just stop seeing them. You can also mute words, so posts containing them don't reach your feed.

Blocking cuts the connection both ways. They cannot message you, follow you, see your posts, or interact with you at all. They are not told, but they can work it out.

Reporting sends it to Atwe to look at. Use it for anything against the rules — harassment, scams, stolen listings, someone pretending to be you or your business. Choose the reason that fits; it decides who reviews it and how fast.

You can report a person, a post, a listing, a job or a video. Reports are read by a person. You are not told the outcome, because that concerns someone else's account, but they are all read.

To block or report, open the three dots on their profile, or on the thing you're reporting.`,
  },
  {
    slug: 'securing-your-account',
    category: 'Your account',
    title: 'Keeping your account secure',
    body: `Four things, in the order worth doing them.

Turn on two-factor authentication. Account, then Settings, then Security. You'll scan a code with an authenticator app, and after that signing in needs a six-digit code as well as your password. You are given ten recovery codes — save them somewhere that isn't your phone.

Check your devices. Settings, then Devices and sessions, lists every place you're signed in, roughly where and when it was last used. Anything you don't recognise, sign it out.

Turn on app lock if other people handle your phone. It asks for a passcode when you open Atwe. You can also lock your wallet and your storefront individually, so they ask every time even after the app is open.

Use an email address you can actually get into. If you ever forget your password, that address is the only way back in.

If you get a sign-in alert you didn't cause, change your password immediately. That signs out every device.`,
  },
  {
    slug: 'notifications',
    category: 'Your account',
    title: 'Controlling notifications',
    body: `Settings, then Notifications.

You can turn off whole categories — likes, replies, follows, endorsements, events, newsletters. Anything to do with money, messages or a job you applied for is never silenced, because those are the ones you'd be upset to miss.

Quality filters cut the noise from strangers: people you don't follow, people who don't follow you, brand-new accounts, accounts with no photo. People you follow always get through.

Quiet hours stop your phone lighting up between two times you choose. The notifications still arrive and are waiting in the app — you just aren't interrupted.

For notifications to reach you when Atwe is closed, turn on push notifications on that device and allow them when your phone asks.`,
  },
  {
    slug: 'your-data',
    category: 'Your account',
    title: 'Your data, and leaving',
    body: `Download your data gives you everything on your account as a file — your profile, posts, chats, orders and settings. Settings, then Your data and storage.

Private browsing means the profiles you look at are not recorded as a visit. It works both ways: while it's on, you also can't see who has looked at yours.

Deactivating hides your account. Your profile stops appearing, you can't be messaged or found, and your posts disappear from feeds. Nothing is deleted, and signing back in brings everything back.

Deleting is permanent. Your account and everything on it goes, and it cannot be undone. Deactivate first if you are at all unsure.

If you want a formal copy of your data or a formal deletion under data protection law, ask through Help and refunds and it is logged and answered within thirty days.`,
  },
  {
    slug: 'contacting-support',
    category: 'Your account',
    title: 'Getting help from a person',
    body: `If nothing here answers it, open Settings, then Help, and write to us. It arrives as a message and the reply comes back the same way, so the whole conversation stays in one place.

It helps to include:

- What you were trying to do
- What happened instead
- The order number, or the @username, if it involves one
- A screenshot if there's something to see

For anything about a payment, use Account, then Help and refunds, instead. That way the payment itself is attached and nobody has to go looking for it.

If you cannot sign in at all, use Forgot password on the sign-in screen. If your account has been suspended, there is an Appeal option on that same screen — it goes to a person.`,
  },
];

module.exports = { HELP_ARTICLES };
