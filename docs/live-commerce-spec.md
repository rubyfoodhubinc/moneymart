# MoneyMart Live Commerce — Product Spec (v1)

Source: owner's Whatnot onboarding screenshots (41) and a 24-minute screen recording of Whatnot
and TikTok Shop (2026-11-17, kept in `~/Desktop/moneymatwhatnut`). These show how the category works.
We rebuild the **business model and mechanics**, not the product: no names, logos, artwork, copy, colours,
layouts-by-trace, sounds or icons from either app. Everything below uses MoneyMart's own words and
navy/gold premium identity. Generic industry terms (auction, Buy It Now, giveaway, category, shipping)
are fine.

## 0. Gaps in MoneyMart today

| Area | Today | Needed |
|---|---|---|
| Seller goes live | Impossible — streams are seed data only | Create, schedule, start, run and end a show from the phone |
| Show ownership | `activate` / `end` endpoints have no auth | Only the host (and their moderators) can control a show |
| Listings in shows | A listing is standalone; nothing puts it into a show | Shop inventory → show queue → "run" item live |
| Categories | 10 flat categories | ~35 categories × subcategories, searchable, A–Z / Popular / New, "Request a category" |
| Video | Demo HLS loops | Real seller camera → low-latency broadcast → viewers |
| Live auction | Timed lots of days | 5–60 s "sudden death" item timers, +1 bid, custom bid, winner banner |

## 1. Buyer experience

### 1.1 Home
- Search bar, messages, notifications, rewards button.
- Horizontal category chips (For You, Following, then the buyer's categories).
- "Get started selling" progress card for users who started seller onboarding.
- Two-column grid of show cards: host avatar + name, `LIVE · viewers` badge or scheduled time with
  a bookmark/remind button, cover image, title, category link, short tags (e.g. "$1 starts").
- Category landing: rows "Top sellers (viewers)", subcategory chips with live viewer counts,
  sort tabs Popular / New & noteworthy / Category filter, Buy It Now tab.
- Floating mini-player (picture-in-picture) when leaving a show.

### 1.2 Categories tab
- Grid of category tiles with live viewer counts; tabs Recommended / Popular / A–Z.
- "Trending today" chips. Tapping a tile with subcategories opens the subcategory grid.

### 1.3 Live show room (full-screen vertical video)
Top bar: host avatar, name, rating, average ship time, Follow, category rank ("#1 in Tools"),
viewer count, collapse button. Optional pinned banners (shipping promise, explicit content warning).

Left overlays: **Watch-to-earn** timer badge, **Show notes** sticky note.
Right overlays: **Giveaway** card with entry count; rail: More, Clip, Share, Wallet, Shop (item count).

Chat: last ~5 messages over video, roles (Host, Mod), join events, tips ("Tipped $5"),
purchase celebrations ("X made a first purchase"), emoji/heart burst button, "Say something…" input,
mention, muted-word filtering.

Item card (bottom): thumbnail, title, condition, price, shipping + taxes chip (tap → breakdown sheet:
item, shipping, estimated total), status line ("X is winning!", "X won!", "Sold", "N left").

Action bar states:
- Auction running: **Custom** (enter max) + **Bid: $N »** (next increment), countdown with +seconds on late bids.
- Buy It Now item: **Checkout** + **Buy Now »**, quantity left.
- Between items: "Awaiting next item"; before start: "Auction hasn't started"; after: "Auction ended".
- Scheduled show (not yet live): countdown "Show starts in 27m 52s", **Save & notify me**, **Share show**.
- Ended: "Show has ended" + **View upcoming shows**.

First bid without payment/address → sheet "To buy in live shows we need your payment and shipping info"
(nothing charged until you win) → **Add info**.

Host sheet (tap host): stats (rating/reviews, avg ship time, items sold), category rank → leaderboard,
Tip, View profile, Message, Mention, Block, Report. "Follow this seller" prompt after watching a while.

Shop sheet (inside show): searchable list of the host's inventory with qty, price, bids, remind bell.

### 1.4 Seller profile
Stats row, followers/following, bio, Follow / Message / Tip; tabs Shop · Shows · Reviews · Clips.
Verified-brand badge where applicable.

### 1.5 Activity, account, rewards
- Activity: Purchases / Bids / Offers / Saved, filters (In progress, Completed, Refunds), refer-a-friend card.
- Friends: online/offline, recommended, contact sync, activity-status toggle.
- Account: referrals & credits, rewards/coupons, account health, payments & shipping, gift cards,
  addresses, verified buyer, notifications (buyer/seller/important), account controls.
- Rewards: referrals, challenges ("watch shows for 10 min"), points shop (chat effects, purchase
  announcements), coupons. Per-seller **rewards club** tiers (spend / purchases / shows watched → coupons + badge),
  seasonal reset.
- Buyer protection policy pages: claim window by category, refund flow, not-covered list.

## 2. Seller experience

### 2.1 Seller onboarding (one-time)
1. "Interested in selling?" intro → rules screen (fees, buyer pays shipping, honour sales and giveaways,
   sell honestly, teens need approval) with SMS consent checkbox.
2. Main category (tile grid) → subcategories (chips).
3. Individual vs registered business → business type (reseller, liquidator, brand, retailer, consignment, other).
4. Where you sell today (multi) → social handles.
5. Monthly revenue band → inventory size band → team size → hours live per week.
6. Return address (map-confirmed, legal name).
7. "Get ready to go live" checklist: Create show → Add products → Bring in buyers → Go live; new-seller offers.

### 2.2 Create / schedule a show
Wizard: frequency (1/wk recommended, 2/wk, 3+/wk, one-time) → days → start time → suggested calendar
(editable dates) → title (150) → category + format (Auction / Buy It Now / Mystery sets) → thumbnail
(+ optional preview video) → upcoming shows summary.
Full form (Schedule a show): name, date/time, repeat, moderators, media, primary category & subcategory,
shipping settings (free pickup, domestic services, who pays), show options (continuous lot numbering),
content (explicit toggle), muted words, primary language, discoverability (public/private link),
promote toggle.

### 2.3 Pre-live room
Show card with "Starts tomorrow 1:00 AM", checklist, Shop button (add products), Verify account,
Add to calendar, Ask (help), Search. Camera + microphone permission prompts.

### 2.4 Verification gate (before first live)
Phone ✓ → payment method → identity (individual) or business (name, tax ID, website, registered
address) via a KYC vendor → live-access review (minutes). Gated categories need extra approval.

### 2.5 Seller hub
Upcoming shows (add/share), today's tasks, connect external inventory, commission rate, account health
(on-time shipping, refund-free, cancellation-free, support response rates over 12 weeks).
Seller tools: Manage (inventory, shows, offers, customer support inbox) · Sales (payouts, fulfilment,
orders, tips) · Promotions (promote tools: sales from promotions, ROI, spend) · Performance (commission
by category, premier shop programme, analytics, account health) · Settings (shipping, seller status &
permissions, gated categories, connected apps, vacation mode). Finances: payouts, transactions, tax docs.

### 2.6 Running a live show (host console)
Camera preview full-screen; host controls overlay: queue of products, "run next item", choose timer
(5/10/15/30/60 s, sudden death), starting price, pin message, start giveaway, moderators, end show.
Same chat as viewers with host badge. Sold item → auto order for the winner.

## 3. Platform rules (server)
- Live item auction: `start(itemId, startPrice, seconds)`; each bid ≥ current + increment; bid in the
  last N seconds extends timer; winner = highest at zero; creates an order with shipping quote.
- Buy It Now in show: decrement quantity atomically; sold-out state.
- Giveaways: entries by follow/watch; host draws winner; free item order.
- Watch-to-earn and challenges accrue points; points spend in rewards shop.
- Shipping calculated from seller return address and buyer address; buyer pays shipping once per show
  (shipping cap per show option).
- Commission: tiered by category and volume (start 8 %), shown in seller hub.
- Moderation: mute words, block/report, explicit flag, mod roles.

## 4. MoneyMart identity rules (no copying)
- Names: **MoneyMart Live** (shows), **Seller Studio** (seller hub), **Bid Boost** / **Snap Bid** for quick
  bid, **Show Board** for show notes, **Prize Drop** for giveaways, **Watch & Earn Coins**.
- Colours: existing navy + gold tokens; our own iconography (SF Symbols) and our own copy.
- Categories: generic retail names; our own tile artwork (generated or SF Symbols), never their images.
- No vendor marks or partner names in UI copy unless we actually contract with that vendor.

## 5. Build phases
1. **Foundations**: category taxonomy (+subcategories, search, request); show model owned by a seller;
   auth on every show mutation; inventory → show queue; seller onboarding questionnaire + return address.
2. **Create/schedule show**: wizard + full form, upcoming shows, reminders, share links.
3. **Go live**: camera/mic broadcast to a live-video provider, viewer playback, host console,
   live item auctions with short timers, Buy It Now in show, winner → order.
4. **Live room polish**: chat roles/mods, tips, emoji bursts, shipping sheet, payment-info gate,
   host sheet, follow prompt, mini-player, show ended / scheduled states.
5. **Seller Studio**: orders/fulfilment, payouts, account health metrics, commission, promotions, vacation.
6. **Engagement**: giveaways, watch & earn, challenges, rewards clubs, referrals, clips, leaderboards.
7. **Trust**: verification vendor, gated categories, buyer protection claims, reports/blocks.
