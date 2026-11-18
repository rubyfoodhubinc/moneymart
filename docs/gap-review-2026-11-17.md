# Gap review — 17 Nov 2026

Reference re-checked: the 41 onboarding screenshots and all 147 frames of the 24-minute walkthrough
(`~/Desktop/moneymatwhatnut`). Build checked file by file (API, iPhone, web). Mechanics only — MoneyMart keeps its
own names, colours and copy (see `live-commerce-spec.md` §4).

Privacy: frames t_141 (a recovery key visible behind the app switcher) and screenshots 0728, 0743–0747, 0750
(real name/address) must be blurred before the reference is shared.

## Built and working
Categories (34 + subcategories, request a category) · seller onboarding questionnaire + return address · show
scheduling wizard + full form · live video (IVS primary, Cloudflare backup) · host console (queue, timers, sudden
death, Buy It Now, end show) · live auctions with late-bid extension · escrow, pay, confirm, dispute (API/web) ·
notifications + iPhone push · Didit seller verification · Ore + President Ore + Owner console.

## Gaps, in the order they are being fixed

### Wave A — a real live show must work end to end on iPhone ✅ done 17 Nov (verify-community.mjs; iPhone test testBuyerAddressOrderAndLiveRoom)
| # | Gap | Fix |
|---|---|---|
| A1 | iPhone buyers cannot pay for, confirm or dispute what they win | Order detail screen: pay, track, confirm receipt, open a claim |
| A2 | No buyer shipping address; bids accepted with no way to ship | Buyer addresses; "add your shipping info" gate before the first bid or buy (nothing charged until you win) |
| A3 | Shipping is a flat zone price; show's shipping cap and free pickup ignored | Quote from seller return address → buyer address; per-show cap (pay shipping once per show up to the cap); pickup |
| A4 | No follow system (counts static, web follow fake) | Follow / unfollow, real counts, "seller you follow is live" alerts, Following feed |
| A5 | Tapping the host does nothing; no seller profile on iPhone | Host sheet (stats, follow, profile, share, report, block) + seller profile (shop, shows, reviews) |
| A6 | No block/report; moderators have no powers | Report (user/listing/show) to the Owner console; block hides chat both ways; mods can pin, mute, remove messages |
| A7 | Viewers can't see the show's items | Shop sheet in the live room: upcoming items, price, remind |
| A8 | Buy It Now sells one unit | Quantity, "N left", atomic decrement, sold out |
| A9 | Live room missing states | Show ended screen + upcoming shows, share while live, pinned message, show notes, explicit warning, winner name ("X is winning / X won"), host pin from iPhone |
| A10 | Fake numbers | Remove random viewer drift for real shows; seller earnings from real orders only |

### Wave B — engagement and seller tools ✅ done 17 Nov (engagement.ts; verify-engagement.mjs; iPhone test testPrizeDropReactionsRewardsAndCategoryPage)
Prize Drop (giveaways: enter, draw, free order) · tips · reactions burst, join lines, first-purchase celebration,
Mod badges · Seller Studio on iPhone: orders to ship (add tracking), payouts, account health (on-time shipping,
refund-free, cancellation-free, response rate), commission by category · Categories tab + category page (live now,
sort Popular / New / Buy It Now) · scheduled cards with start time + remind · watchlist saved to the account.

### Wave C — growth ✅ server + iPhone done 17 Nov (growth.ts, engine/commission.ts) — two items left, see below
Watch & Earn coins, challenges, rewards shop, per-seller rewards club tiers · referrals & credits · offers
(make / accept / counter) · clips · leaderboards ("#N in category") · friends & direct messages · buyer
protection policy pages with claim windows by category · gated categories · tiered commission (from 8%) ·
promotions/boost · vacation mode · web seller onboarding, scheduling and host console · mini-player for live video.

Wave C notes:
- Clips save the moment and a share link; they play once show recordings are switched on (no recording yet).
- Tips and promotions are charged like other payments — simulated until real card payments are live.
- Gated categories are empty by default; the Owner picks them in console › Settings (`categories.gated`).
- **Not built yet:** web seller onboarding / scheduling / host console (sellers use the iPhone app), and the
  mini-player for live video.

### Countries and currencies ✅ done 17 Nov
13 countries with their currencies; the Owner opens or closes each one for buying and for selling (console ›
Countries, audited) and the server enforces it on addresses, bids, buys, seller setup, listings and shows. Live
exchange rates every 6 hours in production (built-in table as fallback); buyers see “≈ in your currency”; shipping
is quoted in the listing's own currency. iPhone: Settings › Country & currency, address and seller country pickers
from the server list.
