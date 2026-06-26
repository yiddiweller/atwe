// demo.js — "Demo mode" showcase seeder.
// Populates the platform with ~100 tagged demo accounts (users.is_demo = true) so an
// admin can preview how a busy, fully-used platform looks. Everything is owned by the
// demo users, so teardown is a single DELETE that cascades away all demo content.
const bcrypt = require('bcryptjs');

// ── Deterministic, royalty-free placeholder media (loaded by URL, no real identities) ──
const portrait = (i, female) => `https://randomuser.me/api/portraits/${female ? 'women' : 'men'}/${i % 100}.jpg`;
const banner = (i) => `https://picsum.photos/seed/atwe-bn-${i}/900/300`;
const postPic = (i) => `https://picsum.photos/seed/atwe-post-${i}/900/650`;
const storyPic = (i) => `https://picsum.photos/seed/atwe-st-${i}/700/1100`;
const prodPic = (i) => `https://picsum.photos/seed/atwe-pr-${i}/800/800`;

const FIRST_M = ['James', 'Daniel', 'Michael', 'David', 'Marcus', 'Ethan', 'Liam', 'Noah', 'Omar', 'Andre', 'Lucas', 'Carlos', 'Ryan', 'Jacob', 'Samuel', 'Nathan', 'Kevin', 'Tariq', 'Diego', 'Aaron', 'Victor', 'Isaac', 'Leon', 'Mateo'];
const FIRST_F = ['Sophia', 'Maria', 'Emma', 'Olivia', 'Aisha', 'Chloe', 'Grace', 'Layla', 'Hannah', 'Nina', 'Priya', 'Sara', 'Zoe', 'Mia', 'Elena', 'Fatima', 'Ava', 'Lily', 'Naomi', 'Ruby', 'Jade', 'Talia', 'Maya', 'Iris'];
const LAST = ['Carter', 'Reyes', 'Nguyen', 'Patel', 'Okafor', 'Bennett', 'Silva', 'Cohen', 'Murphy', 'Khan', 'Rossi', 'Sato', 'Adeyemi', 'Lopez', 'Hughes', 'Ferraro', 'Kim', 'Blake', 'Mensah', 'Novak', 'Haddad', 'Walsh', 'Brooks', 'Diallo'];

// Industries → category (matches the signup industry list), business-name parts,
// headlines, post lines, and product samples. Keeps the demo varied + realistic.
const IND = [
  { cat: 'Technology', biz: ['Northstar Labs', 'Pixel Forge', 'Cloudbase', 'Bytewise'], head: ['Software engineer', 'Founder & CTO', 'Product designer', 'Full-stack developer'], posts: ['Shipped a big refactor today — feels good to delete code. #buildinpublic', 'Hot take: the best feature is the one you didn’t build.', 'We’re hiring two engineers. DMs open.', 'Three years in and still learning something new every week.'], prods: ['1-hr product strategy call', 'Landing page audit', 'API integration package'] },
  { cat: 'Marketing', biz: ['Bright Reach', 'Loud & Clear', 'Tidepool Media'], head: ['Brand strategist', 'Growth marketer', 'Content lead'], posts: ['Your brand is a promise. Keep it. ✨', 'Stop boosting posts. Start telling stories.', 'Case study: 3x leads in 60 days. Thread 🧵'], prods: ['Brand strategy session', 'Social content pack (12 posts)', 'Marketing audit'] },
  { cat: 'Real Estate', biz: ['Keystone Realty', 'Summit Homes', 'Harbor Properties'], head: ['Realtor', 'Broker', 'Property manager'], posts: ['Just listed 🏡 3bd / 2ba with the best light I’ve seen all year.', 'Open house this Sunday — come say hi!', 'Rates moved. Here’s what it means for buyers.'], prods: ['Home valuation', 'Staging consult'] },
  { cat: 'Healthcare', biz: ['Bright Dental', 'Wellspring Clinic', 'CarePoint'], head: ['Dentist', 'Physiotherapist', 'Nutrition coach'], posts: ['Reminder: floss the ones you want to keep 🦷', 'Small habits, big health. Start with water.', 'Now accepting new patients this month.'], prods: ['Initial consultation', 'Wellness plan'] },
  { cat: 'Fitness', biz: ['Iron Tide Gym', 'PeakForm', 'MoveWell Studio'], head: ['Personal trainer', 'Yoga instructor', 'Strength coach'], posts: ['Consistency beats intensity. Show up. 💪', 'New 6-week program drops Monday.', 'Form > ego. Every single time.'], prods: ['1:1 training session', '6-week program', 'Form check video review'] },
  { cat: 'Food & Beverage', biz: ['Olive & Ember', 'Daily Grind', 'Saffron Kitchen'], head: ['Chef', 'Café owner', 'Caterer'], posts: ['Fresh batch out of the oven 🥐', 'Catering 40 covers this weekend — wish us luck!', 'New seasonal menu is live.'], prods: ['Catering (per head)', 'Private dinner', 'Pastry box'] },
  { cat: 'Construction', biz: ['Apex Build', 'Cornerstone Co.', 'TrueLine Contractors'], head: ['General contractor', 'Site manager', 'Carpenter'], posts: ['Before/after on this kitchen reno 🔨', 'Booked through spring — thank you all.', 'Measure twice, cut once. Always.'], prods: ['Renovation estimate', 'Handyman half-day'] },
  { cat: 'Legal', biz: ['Hale & Park', 'Justice Lane', 'Meridian Law'], head: ['Attorney', 'Paralegal', 'Notary'], posts: ['Read the contract. Then read it again.', 'Free 15-min consult for small businesses this week.', 'Know your rights — short thread.'], prods: ['Contract review', '30-min legal consult'] },
  { cat: 'Finance', biz: ['Ledger & Co.', 'Cascade Advisors', 'BluePeak Finance'], head: ['Accountant', 'Financial advisor', 'Bookkeeper'], posts: ['Tax season tip: track it monthly, not in April.', 'Compound interest is the quietest superpower.', 'Helping 3 founders clean up their books this week.'], prods: ['Bookkeeping (monthly)', 'Tax prep', 'Financial plan'] },
  { cat: 'Education', biz: ['BrightMinds', 'Lumen Tutoring', 'Open Path'], head: ['Tutor', 'Course creator', 'Coach'], posts: ['A good teacher makes you curious, not just correct.', 'New cohort opens next week — 6 seats left.', 'Free study guide in the comments 👇'], prods: ['1:1 tutoring hour', 'Course access'] },
  { cat: 'Photography', biz: ['Goldhour Studio', 'Frame & Field', 'Lumen Photo'], head: ['Photographer', 'Videographer', 'Photo editor'], posts: ['Golden hour never misses 📸', 'Booking fall portraits now.', 'Behind the scenes from yesterday’s shoot.'], prods: ['Portrait session', 'Event coverage (hr)', 'Photo editing (10 imgs)'] },
  { cat: 'Beauty', biz: ['Glow Bar', 'Luxe Lounge', 'Bloom Studio'], head: ['Hair stylist', 'Esthetician', 'Makeup artist'], posts: ['Fresh color, fresh start 💇‍♀️', 'A few openings this weekend!', 'Skincare is self-care. Be gentle.'], prods: ['Cut & style', 'Facial', 'Bridal makeup'] },
  { cat: 'Automotive', biz: ['TorqueWorks', 'Apex Auto', 'RoadReady'], head: ['Mechanic', 'Detailer', 'Auto electrician'], posts: ['Brakes done right the first time 🔧', 'Winter check-ups are on special this month.', 'That new-car feeling, no new-car price.'], prods: ['Full detail', 'Diagnostic check'] },
  { cat: 'Events', biz: ['Confetti Co.', 'Grand Affair', 'Tempo Events'], head: ['Event planner', 'DJ', 'Florist'], posts: ['Another wedding in the books 💍 so much joy.', 'Now booking summer events!', 'The little details are the whole thing.'], prods: ['Event planning (day)', 'DJ set (4 hrs)', 'Floral package'] },
  { cat: 'Consulting', biz: ['Clarity Partners', 'Northwind Consulting', 'Pivot Group'], head: ['Business consultant', 'Operations advisor', 'Strategy lead'], posts: ['Strategy is choosing what NOT to do.', 'Helped a client cut ops costs 22% this quarter.', 'Clarity first, then speed.'], prods: ['Strategy workshop', 'Ops review'] },
  { cat: 'Fashion', biz: ['Thread & Co.', 'Velvet Lane', 'Mode Atelier'], head: ['Designer', 'Stylist', 'Tailor'], posts: ['New drop this Friday 🧵 limited run.', 'Fit is everything. Always tailor.', 'Sustainable fabrics, timeless cuts.'], prods: ['Personal styling', 'Custom tailoring', 'Lookbook piece'] },
];

const POOL_TXT = ['Grateful for this community 🙏', 'Working on something exciting — more soon.', 'What’s everyone reading this week?', 'Coffee, then conquer. ☕', 'Best advice you ever got? Drop it below.', 'Networking really is just being genuinely curious about people.'];
const STORY_BG = ['g1', 'g2', 'g3', 'g4', 'g5'];

// One demo run. `client` is a pg client/pool with .query; `adminId` follows some demo
// users so the admin's own feed/stories fill up. Returns the count created.
async function seedDemo(client, adminId) {
  const pass = await bcrypt.hash('demo-' + Date.now() + '-' + Math.round(Math.random() * 1e9), 8);
  const N = 100;
  const ids = [];
  let imgCounter = 1;
  for (let i = 0; i < N; i++) {
    const ind = IND[i % IND.length];
    const isBiz = i % 5 === 0; // ~20% businesses
    const female = i % 2 === 0;
    let name, username, headline;
    if (isBiz) {
      name = ind.biz[i % ind.biz.length] + ' ' + (['Studio', 'Co.', 'Group', ''][i % 4]);
      name = name.trim();
      username = name.toLowerCase().replace(/[^a-z0-9]+/g, '') + (i);
      headline = ind.cat + ' · ' + ind.head[0];
    } else {
      const fn = (female ? FIRST_F : FIRST_M)[i % 24];
      const ln = LAST[(i * 3) % LAST.length];
      name = fn + ' ' + ln;
      username = (fn + ln).toLowerCase() + (i);
      headline = ind.head[i % ind.head.length];
    }
    const bio = `${headline} ${isBiz ? '' : '|'} ${ind.cat}. ${['Let’s build something great.', 'Open to collaborations.', 'Always learning.', 'Here to help.'][i % 4]}`.trim();
    const email = `demo${i}@demo.atwe.local`;
    const av = portrait(i, female);
    const bn = banner(i);
    const verified = isBiz && i % 3 === 0;
    const bvs = isBiz ? (verified ? 'verified' : 'none') : 'none';
    try {
      const r = await client.query(
        `INSERT INTO users (name, email, password_hash, username, email_verified, dob, avatar, banner, bio, headline, categories, account_type, verified, business_verify_status, is_demo, created_at)
         VALUES ($1,$2,$3,$4,true,'1990-01-01',$5,$6,$7,$8,$9::jsonb,$10,$11,$12,true, now() - make_interval(days => $13))
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [name, email, pass, username, av, bn, bio, headline, JSON.stringify([ind.cat]), isBiz ? 'business' : 'personal', verified, bvs, (i % 30)]
      );
      if (!r.rows[0]) continue;
      const uid = r.rows[0].id;
      ids.push({ id: uid, isBiz, ind });
      // Posts (1–4), ~35% with a photo, spread over the last ~12 days.
      const nPosts = 1 + (i % 4);
      const lines = ind.posts.concat(POOL_TXT);
      for (let k = 0; k < nPosts; k++) {
        const body = lines[(i + k) % lines.length];
        const withImg = (i + k) % 3 === 0;
        const mins = (k * 600 + (i % 500)) + 30; // minutes ago
        const pr = await client.query(
          `INSERT INTO posts (user_id, body, image, to_main, created_at) VALUES ($1,$2,$3,true, now() - make_interval(mins => $4)) RETURNING id`,
          [uid, body, withImg ? postPic(imgCounter++) : null, mins]
        );
        // Index any #hashtags so the topic boosts have something to match.
        const tags = [...new Set((body.match(/#([a-z0-9_]{2,30})/gi) || []).map((t) => t.slice(1).toLowerCase()))];
        for (const t of tags) await client.query('INSERT INTO post_hashtags (post_id, tag) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pr.rows[0].id, t]);
      }
      // Stories (~30% of users), photo or text-on-gradient, live for 24h.
      if (i % 3 === 0) {
        const photo = i % 2 === 0;
        await client.query(
          `INSERT INTO stories (user_id, kind, media, caption, bg, expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5, now() + interval '24 hours', now() - make_interval(hours => $6))`,
          [uid, photo ? 'image' : 'text', photo ? storyPic(imgCounter++) : null, photo ? '' : (ind.posts[0] || 'Hello 👋'), STORY_BG[i % STORY_BG.length], (i % 20)]
        );
      }
      // Products for businesses (1–3), with photos.
      if (isBiz) {
        const nProd = 1 + (i % 3);
        for (let k = 0; k < nProd; k++) {
          const pname = ind.prods[k % ind.prods.length];
          const cents = (20 + ((i + k) % 40)) * 500; // $100–$300-ish
          const kind = ['service', 'service', 'digital', 'physical'][k % 4];
          await client.query(
            `INSERT INTO products (business_id, name, description, price_cents, image, kind, active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,true, now() - make_interval(days => $7))`,
            [uid, pname, `${pname} from ${name}. Quality you can count on.`, cents, prodPic(imgCounter++), kind, (i % 20)]
          );
        }
      }
    } catch (e) { /* skip a colliding username/email, keep going */ }
  }
  // Follow graph: each demo user follows a spread of others; the admin follows ~30 of
  // them so their own feed, story tray and Following timeline fill up.
  const allIds = ids.map((x) => x.id);
  for (let a = 0; a < allIds.length; a++) {
    const followCount = 5 + (a % 20);
    for (let f = 1; f <= followCount; f++) {
      const target = allIds[(a + f * 3 + (a % 7)) % allIds.length];
      if (target && target !== allIds[a]) await client.query('INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [allIds[a], target]);
    }
  }
  if (adminId) {
    for (let a = 0; a < Math.min(35, allIds.length); a++) {
      await client.query('INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [adminId, allIds[a * 2 % allIds.length]]);
    }
  }
  return allIds.length;
}

// Tear it all down: deleting the demo users cascades to their posts, follows, stories,
// products, hashtags, etc. (everything is owned by a demo user).
async function teardownDemo(client) {
  const r = await client.query('DELETE FROM users WHERE is_demo = true RETURNING id');
  return r.rowCount;
}

module.exports = { seedDemo, teardownDemo };
