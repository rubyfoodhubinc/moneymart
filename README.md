# MoneyMart — Bid. Stream. Win.

A hybrid **live-commerce and auction platform**: creator-led live auctions
(Whatnot-style), traditional expert-catalogued auction house sales
(Sotheby's-style), and an always-on verified secondary marketplace — plus
**Studio**, a no-code storefront builder in the Wix model.

Built from the *MoneyMart Master Product Blueprint v2.0* (see
[`docs/MoneyMart-Blueprint.md`](docs/MoneyMart-Blueprint.md)).

---

## Status

| Surface | State |
|---|---|
| **Auction engine** (Node + Socket.IO) | ✅ Live — **31/31** verification checks pass |
| **Web platform** (Vite + React + Router) | ✅ Live on http://127.0.0.1:3000 — 18 routes, HMR verified |
| **Studio** (no-code storefront builder) | ✅ Live — block library, theming, inline copy editing, publish |
| **API** (REST + WebSocket) | ✅ Live on http://127.0.0.1:4317 |
| **Mobile app** (Expo SDK 53, §5 screen map) | ✅ Live on http://127.0.0.1:8082 (Expo web target) — bundles 940 modules |
| **Production deployment** | ✅ **Live** — https://moneymart-production.up.railway.app |
| **Repository** | ✅ https://github.com/rubyfoodhubinc/moneymart |
| **Payments & escrow** | ✅ Provider-abstracted rails + enforced hold/release state machine |
| **Verification** | ✅ **197 automated checks** across 7 suites — `pnpm verify:all` |
| **TV / IPTV** (§7) | ✅ Live on http://127.0.0.1:3200 — D-pad 10-foot UI, QR bridge, XMLTV EPG |

---

## Run it

```bash
# one-time
./scripts/ensure-env.sh          # routes native addons to WASM builds (see docs/ENVIRONMENT.md)
pnpm install

# start every surface
pnpm dev                         # API + web + mobile
pnpm dev --no-mobile             # API + web
pnpm dev --api                   # API only

# or individually
./scripts/start-api.sh           # http://127.0.0.1:4317
./scripts/start-web.sh           # http://127.0.0.1:3000
./scripts/start-mobile.sh --web  # http://127.0.0.1:8082
```

Then open **http://127.0.0.1:3000** (web) or **http://127.0.0.1:8082** (mobile).

> On a phone, run `./scripts/start-mobile.sh`, scan the QR code with Expo Go, and
> set `extra.apiUrl` in `apps/mobile/app.json` to your machine's LAN address so the
> device can reach the API.

### Deploy — one origin, one certificate

```bash
node scripts/make-cert.mjs --trust   # local CA + localhost cert, installed in the keychain
pnpm deploy:local                    # builds web + TV, serves everything over HTTPS
pnpm verify:deploy                   # 28 deployment assertions
```

That starts **one** gateway on `https://localhost:3443` serving:

| Path | Served |
|---|---|
| `/` | the web SPA, with deep-link fallback (`/auctions/auc_rolex`, `/studio`, …) |
| `/tv/` | the 10-foot TV bundle, isolated under its own asset path |
| `/api` | the REST gateway |
| `/socket.io` | the realtime WebSocket upgrade |

One origin removes the CORS surface, needs a single certificate, and means a deep
link resolves on a hard refresh against the very API it calls. The clients are
built with an empty `VITE_API_URL`, so they resolve the gateway from the page
origin at runtime.

**Hardening asserted by the suite:** HSTS two years + preload, a CSP with no
`unsafe-eval`, `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`,
camera/microphone restricted to self, `NODE_ENV=production` blocking every `dev/*`
endpoint (403), hashed assets `immutable` while documents revalidate, and a
missing asset returning `404` instead of silently serving the shell.

> **Env contract:** only `VITE_`-prefixed variables reach client code, and an
> empty value means "same origin". Per-environment defaults live in
> `apps/web/.env` and `apps/web/.env.production`. A `NEXT_PUBLIC_*` name would be
> inlined as a literal and silently ignored.

### Verify everything

```bash
pnpm verify:all                  # 155 checks across 6 suites — the release gate
MM_MOBILE_SUITE=1 pnpm verify:all  # 197 checks — adds the native mobile build
```

```
═══════════════════════════════════════════════════════════════
  MONEYMART — FULL VERIFICATION AUDIT
═══════════════════════════════════════════════════════════════
  PASS  Auction engine (§9.2 rules)            31 passed
  PASS  Realtime Socket.IO (§9.2 broadcast)    19 passed
  PASS  Payments & escrow (§9.1)               31 passed
  PASS  TV / IPTV (§7)                         35 passed
  PASS  Mobile (native build)                   42 passed
  PASS  Unified deployment                     28 passed
  PASS  End-to-end health                      11 passed
───────────────────────────────────────────────────────────────
  TOTAL  197 passed   0 failed
═══════════════════════════════════════════════════════════════
```

Individually:

```bash
pnpm verify            # engine rules over REST (31)
pnpm verify:realtime   # Socket.IO broadcast contract (19)
pnpm verify:escrow     # payments, escrow, disputes (31)
pnpm verify:tv         # QR, handoff, EPG, 10-foot UI, D-pad (35)
pnpm verify:mobile     # icons, store identity, Hermes bundles, QR deep link (42)
pnpm verify:deploy     # TLS, single origin, cache, TV isolation (28, needs deploy:local)
pnpm health            # end-to-end product health (11)
```

```
════════ MoneyMart — end-to-end health check ════════
1. API gateway · 2. Seeded marketplace · 3. Engine round-trip
4. Studio storefront round-trip · 5. Web surfaces · 6. Production hardening
  PASSED 11   FAILED 0
```

```
════════ MoneyMart Auction Engine — live verification ════════
1. Gateway · 2. Increment check · 3. Validation pipeline · 4. Self-bid guard
5. Already-winning guard · 6. Anti-snipe extension · 7. Auto-bid proxy resolution
8. Buyer's premium tiers · 9. Stream item queue · 10. Search service
11. Selling flow · 12. Settlement → order → payout · 13. Price history
  PASSED 31   FAILED 0
```

---

## Architecture

```
moneymart/
├── apps/
│   ├── tv/                     # TV / IPTV 10-foot UI (Tizen, webOS, HbbTV)
│   │   └── src/
│   │       ├── lib/focus.tsx   # D-pad spatial navigation engine (§7.2)
│   │       ├── components/     # rows, cards, QR bridge
│   │       └── screens/        # Home, Stream, Browse, Item, Account (§7.3)
│   ├── mobile/                 # Expo SDK 53 + React Native 0.79 (iOS/Android/web)
│   │   ├── App.tsx             # navigation shell: onboarding stack + main tabs
│   │   └── src/
│   │       ├── screens/        # 13 screens per the §5.2 screen map
│   │       ├── components/     # icons, UI primitives, auction surfaces
│   │       ├── lib/            # api + socket, hooks, format, markets
│   │       ├── store/          # session (AsyncStorage-persisted)
│   │       └── theme/          # React Native projection of @moneymart/tokens
│   └── web/                    # Vite + React 19 + React Router 7 + Tailwind 4
│       └── src/
│           ├── components/     # design system + auction surfaces
│           ├── pages/          # 18 routed screens
│           ├── lib/            # api client, realtime hooks, format, storefront schema
│           └── store/          # session, watchlist
├── packages/
│   ├── tokens/                 # single source of truth: palette, type, motion, §10 fees
│   └── types/                  # shared domain model + Socket.IO event contract
├── services/
│   └── api/                    # Express + Socket.IO + in-memory domain store
│       └── src/
│           ├── engine/         # auction engine (§9.2), money/fee engine (§10)
│           ├── seed.ts         # a living auction house: 4 streams, 14 lots, 8 users
│           └── index.ts        # REST gateway + realtime layer
├── scripts/                    # launchers, env repair, health + verification suites
└── docs/
    ├── MoneyMart-Blueprint.md  # extracted product blueprint (source of truth)
    ├── ENVIRONMENT.md          # the macOS native-addon blocker and its fix
    └── next-web-preserved/     # the complete Next.js implementation, kept for other machines
```

### Realtime contract, measured

The Socket.IO suite opens real websocket connections and measures the broadcast
path rather than trusting it:

```
9. Broadcast latency against the sub-second budget
  6 samples · avg 0.7ms · max 0.7ms
  ✔ every broadcast landed inside the sub-second budget
```

It also proves fan-out to independent clients, outbid notifications routed to the
displaced bidder's personal room, anti-snipe extension broadcasts, viewer-count
join/leave deltas, chat fan-out and pinning, and ladder consistency under nine
overlapping bids from three separate connections.

### Real-time bidding engine (§9.2)

Every documented guarantee is implemented and verified:

* **Atomic ordering** — single-writer, newest-first bid ladder mirroring Redis `LPUSH`
* **Validation pipeline** — funds → increment → time → anti-snipe
* **Anti-snipe** — a bid inside the final 10 s extends the clock by 30 s
* **Proxy auto-bid** — a bidder never overpays: the engine opens at the settlement
  price (rival ceiling + one tiered increment) capped by the bidder's own ceiling,
  so the true maximum is never exposed to the room
* **Rejection reasons** — `below_minimum_increment`, `self_bid`, `already_winning`,
  `rate_limited`, `auction_ended`, `auction_not_live`
* **Settlement** — winner determined at expiry, category-aware buyer's premium
  applied, order created, invoice notification dispatched, stream advances to the
  next queued lot automatically

### Money rules (§10) — one implementation, no drift

| Rule | Value |
|---|---|
| Buyer's premium | 15% standard · **20% luxury** (watches, jewelry, art, vehicles) · Pro 10% / 15% |
| Creator revenue share | **85% creator / 15% platform** on live-stream GMV |
| Cross-border fee | 1.5% buyer-side |
| Tax | VAT 7.5% (NG) · VAT 20% (UK) · HST 13% (CA) · blended 7.25% (US) |
| Payout | 7–10 days after buyer confirmation |

The premium **disclosed on the listing is the premium that settles** — the engine
reads the stored, category-aware rate rather than recomputing it.

---

## Payments & escrow (§9.1)

The blueprint's trust promise — *"seller payout released after buyer confirmation"* —
is implemented as a state machine that refuses illegal transitions:

```
requires_payment ──pay──▶ in_escrow ──buyer confirms──▶ releasing ──▶ released
       │                      │
       │                      ├──dispute──▶ disputed ──refund──▶ refunded
       └──decline──▶ failed ──retry──▶ requires_payment
```

**Enforced invariants** (all verified by the suite):

* A third party cannot pay for someone else's order (`403 not_the_buyer`).
* **The seller cannot release their own funds** — only the buyer's confirmation does.
* Marking an order shipped does **not** release a penny.
* Paying twice is refused (`409 already_paid`).
* A declined card leaves the order reserved and **retryable** — the 5-day payment window works.
* A dispute freezes funds; only an admin can resolve it, and release is refused while disputed.
* `released + refunded` can never exceed what was collected — enforced inside every transition.

**Providers** are pluggable behind one interface. `StripeProvider` (cards,
USD/GBP/CAD) and `PaystackProvider` (NGN cards, transfer, USSD) activate the moment
`STRIPE_SECRET_KEY` / `PAYSTACK_SECRET_KEY` are present; until then a
`SimulatedProvider` runs the identical lifecycle so the flow is never dead-ended.
Declines are reproducible on demand (any amount ending `.13`).

**Buyer-facing UI**: the escrow panel appears on every order in `/account/orders`
with Pay, Confirm receipt, and Report a problem — plus the full audit trail. The
wallet shows platform-wide funds held.

## Deployment

### Live now — Railway

**https://moneymart-production.up.railway.app** serves the whole platform from one
origin, verified by 28 deployment assertions against the live host:

| Path | |
|---|---|
| `/` | web SPA with deep-link fallback |
| `/tv/` | TV / IPTV bundle |
| `/api` | REST gateway |
| `/socket.io` | realtime WebSocket — live bidding confirmed (6 bids, current 8450) |

```bash
pnpm deploy:railway     # build + push the image
pnpm verify:production  # 28 assertions against the live deployment
```

The image compiles the API to plain JavaScript (`tsconfig.build.json`) so the
container runs no TypeScript loader and needs no dev dependencies.

### Runtime configuration

One build targets any backend. The API origin resolves at boot, in order:

1. `/mm-config.json` beside the deployed app — editable after build, so a static
   host can be re-pointed **without a rebuild**
2. `?api=<url>` or a stored value, so a tester can switch backends in the browser
3. `VITE_API_URL`, when explicitly set at build time
4. the page origin — the unified deployment

Resolution completes before the first render, so no request is ever issued
against a stale origin. `apps/web/public/mm-config.json` ships the deployed
default.

### CORS

Split deployments (web on Vercel calling the gateway on Railway) are supported by
an explicit allowlist rather than `origin: true`, which with credentials would
reflect *any* Origin. Configure with `MM_ALLOWED_ORIGINS`; `moneymart.app`,
`www.moneymart.app` and the Railway domain are built in, Vercel preview hostnames
are allowed, and localhost only outside production. A refused Origin answers
`403`, not a 500.

### Web on Vercel

`vercel.json` is committed: SPA fallback, immutable asset caching and the same
security headers the gateway applies. Deploy needs an authenticated CLI:

```bash
vercel login          # interactive — requires a browser
vercel --prod
```

### Custom domain

`www.moneymart.app` → point at the Railway service (or Vercel) and set
`MM_ALLOWED_ORIGINS` to the final host. The gateway reads `X-Forwarded-Proto`, so
HSTS is sent whenever TLS terminates at the platform edge.

## Mobile delivery

The app builds for real devices, not just the Expo web target:

```bash
pnpm brand                    # regenerate every icon/splash from code
pnpm build:mobile:native      # Hermes bundles for iOS and Android
pnpm verify:mobile            # 42 checks on the above
```

**Icons and splash are generated, not committed.** `scripts/make-brand-assets.mjs`
draws the mark with a small software rasteriser — shapes are sampled on a
4x supersampled grid and box-filtered down, which supplies anti-aliasing and
correct edge blending — then encodes PNG with `zlib` from the standard library.
No image dependency, and the artwork is reviewable in a diff and re-renders at
any size if the palette in `@moneymart/tokens` changes.

It emits the iOS icon, the Android adaptive foreground **and** monochrome layer
(Android 13+ themed icons), the Expo splash, and the web/PWA/TV icons.

**QR → phone bidding (§7.3), end to end.** The TV shows a code encoding
`moneymart://bid/<auctionId>?token=…&exp=…`. The app's link handler:

1. parses the custom scheme (a standard `URL` parser cannot — it reads `bid` as
   the host, so the scheme, path and query are split explicitly),
2. checks the 15-minute expiry client-side,
3. **redeems the token server-side** before trusting the link,
4. routes to the lot, warning rather than failing silently on a stale code.

## TV / IPTV (§7)

The last unbuilt blueprint surface. A standards-based SPA: Tizen, webOS and HbbTV
all run a browser engine, so one codebase reaches every distribution channel in
§7.1.

**D-pad spatial navigation**, not DOM tab order — the next focus target is
whichever registered element lies geometrically nearest in the pressed direction,
with cross-axis alignment weighted 3.2× so rows and columns feel predictable.
Maps Tizen (`10009`) and webOS (`461`) back keys, plus the arrow/Enter codes from
Android TV remotes.

**§7.2 compliance is asserted, not assumed:**

| Requirement | Enforced as |
|---|---|
| 32pt minimum body text | `--tv-body: 2rem` |
| 56pt minimum section headings | `--tv-heading: 3.5rem` |
| 200×80px minimum focus targets | `--tv-target-min-w` / `--tv-target-h` |
| 4px gold focus border | `--tv-focus-width` + gold token |
| Overscan-safe margins | `--tv-overscan` |
| Row-based composition | `TvRow` is the only layout primitive |
| One action prompt per state | single-confirm modal pattern |

**QR bridge (§7.3).** Bidding from a remote is hostile, so the Bid panel slides in
from the right and presents a scannable code. The QR is **generated server-side**
by a dependency-free encoder in `services/api/src/lib/qr.ts`, so the TV needs no
QR library and no network round-trip to paint the code.

**IPTV (§7.4).** `GET /api/tv/epg.xml` publishes a valid XMLTV guide — one
channel and one programme per stream — so MAG, Formuler and IPTV Smarters
middleware can render MoneyMart auctions in their own grid. Handoff tokens are
signed for a 15-minute window and verified server-side.

## Studio — the Wix-style builder

`/studio` gives any creator a no-code storefront:

* **10 block types** — hero, live-now, featured lots, category grid, about, stats,
  testimonials, recent sales, newsletter, CTA
* **Block library + reorder + duplicate + show/hide**, with per-block options
  (columns, item limits, tone)
* **4 brand-safe theme presets** plus accent, corner-radius, spacing and tagline controls
* **Inline copy editing** on a live canvas fed by the creator's real lots and stream
* **Desktop / mobile preview** toggle
* **One document, every surface** — the same storefront renders on web now and on
  mobile/TV when those apps ship

A storefront is a JSON document (`Storefront` in `@moneymart/types`) stored by the
API and rendered by `/shop/:handle` and `/seller/:handle`.

---

## Design system

The five mandated brand colours are law, defined once in `@moneymart/tokens` and
imported by every surface — never hard-coded in an app.

| Token | Hex | Role |
|---|---|---|
| Primary Gold | `#F5A623` | CTAs, bid buttons, price tags |
| Deep Navy | `#0D1B2A` | Primary dark background |
| Electric Green | `#00D4A1` | LIVE badges, winning state, success |
| Pure White | `#FFFFFF` | Surface and readability |
| Charcoal | `#1C1C1E` | Dark UI surfaces, overlay panels |

Typography roles: **Clash Display** (display, ≥18pt) · **Inter** (UI/body) ·
**Space Grotesk** (numerals/data only). Motion follows the blueprint exactly:
1.2 s confetti burst on a win, 1.8 s LIVE pulse ring, 400 ms card-flip reveal.

---

## Environment note — read this before blaming the code

`next dev`, `next build`, native Rollup, Lightning CSS and Tailwind's Oxide scanner
**cannot load on this machine**. macOS Library Validation refuses to map their
linker-signed native addons into the Node process:

```
code signature ... not valid for use in process:
mapping process and mapped file (non-platform) have different Team IDs
```

`scripts/ensure-env.sh` routes each one to its **official WebAssembly build**
(`@rollup/wasm-node`, `lightningcss-wasm`, `@tailwindcss/oxide-wasm32-wasi`), which
runs the same Rust code with no signature requirement. The full investigation,
including every attempt and its result, is in
[`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

The complete Next.js App Router implementation written before this constraint was
confirmed is preserved in [`docs/next-web-preserved/`](docs/next-web-preserved) —
nothing was discarded, and it can be restored on an unconstrained machine.

---

## Demo identities

The seed ships a living auction house. Switch identity from the account menu to
explore buyer, seller and creator flows against the same live data:

| Identity | Role | Markets |
|---|---|---|
| **Ash Vale** (`ashvale`) | Buyer, MoneyMart Pro | US |
| Ada Okonkwo (`adaluxe`) | Creator | Nigeria |
| Marcus Bell (`bellvault`) | Creator | USA |
| Priya Raman (`hautehour`) | Creator | UK |
| Jules Fontaine (`maisonjules`) | Creator | Canada |
| MoneyMart House (`moneymarthouse`) | Admin — unlocks `/admin` | Global |
| Ken Adeyemi / Sofia Marchetti | Competing bidders | NG / UK |

**Try this:** open `/live`, enter *Bell Vault — Grail Night*, bid on the active lot,
then long-press **Bid** to open auto-bid. Switch to another bidder in a second
browser window and watch the ladder move in sub-second time.

---

## Mobile app — §5.2 screen map

| Group | Screens |
|---|---|
| Onboarding (5) | Splash (gold pulse ring) · Welcome carousel (3 slides) · Country & currency · Auth (email + SSO + phone OTP) · Profile setup |
| Main tabs (4) | **Home** (For You / Live Now / Ending Soon) · **Discovery** (search, trending, 3-col categories, creators) · **Sell** (5-step flow with fee calculator) · **Account** |
| Stack (5) | Live rooms list · Live Stream room · Auction Detail · Auto-bid sheet |

The live room follows §4.1 Step 3 exactly: video occupies the top 70% of the
viewport, the bid panel is anchored to the bottom, and chat auto-switches away on
bid interaction so no drop is missed. Long-pressing **Bid** opens the auto-bid
sheet; every price, countdown and increment comes from the same shared token and
money modules the web app uses.

## Keyboard shortcuts (§8.4)

On a lot page: `B` place bid · `W` add to watchlist · `Esc` close panels.
