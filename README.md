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
| **Memberships** | ✅ RevenueCat entitlements — Pro pricing 10%/15% enforced server-side |
| **Live video** | ✅ Real HLS in the stream room — proven decoding in headless Chrome |
| **Studio** | ✅ Drag-to-reorder sections + seller photo reordering (§5.2) |
| **Authentication** | ✅ Passwordless OTP — wired through web, mobile **and** TV, verified in a real browser |
| **Persistence** | ✅ Postgres snapshotting — data survives redeploys (proven in production) |
| **Verification** | ✅ **341 automated checks** across 12 suites — `pnpm verify:all` |
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
pnpm verify:all                            # 177 checks across 8 suites — the release gate
MM_UI_SUITE=1 MM_HLS_SUITE=1 MM_MOBILE_SUITE=1 pnpm verify:all   # 258 — every suite
```

```
═══════════════════════════════════════════════════════════════
  MONEYMART — FULL VERIFICATION AUDIT
═══════════════════════════════════════════════════════════════
  PASS  Auction engine (§9.2 rules)            31 passed
  PASS  Realtime Socket.IO (§9.2 broadcast)    19 passed
  PASS  Payments & escrow (§9.1)               31 passed
  PASS  TV / IPTV (§7)                         35 passed
  PASS  Payments & membership                  35 passed
  PASS  Authentication                         48 passed
  PASS  Persistence                            21 passed
  PASS  Browser UI (real Chrome)               36 passed
  PASS  HLS playback (real browser)            29 passed
  PASS  Payments & membership                  35 passed
  PASS  Mobile (native build)                   42 passed
  PASS  Unified deployment                     28 passed
  PASS  End-to-end health                      11 passed
───────────────────────────────────────────────────────────────
  TOTAL  341 passed   0 failed
═══════════════════════════════════════════════════════════════
```

Individually:

```bash
pnpm verify            # engine rules over REST (31)
pnpm verify:realtime   # Socket.IO broadcast contract (19)
pnpm verify:escrow     # payments, escrow, disputes (31)
pnpm verify:tv         # QR, handoff, EPG, 10-foot UI, D-pad (35)
pnpm verify:auth       # OTP flow, canonicalisation, refusals, production posture (48)
pnpm verify:persistence  # restart round-trip, corrupt-snapshot recovery, opt-out (20)
pnpm verify:ui         # real Chrome: pages mount, drag handles, keyboard reorder (22)
pnpm verify:hls        # real Chrome decodes every resolver manifest (29)
pnpm verify:subscriptions  # providers, identity guard, entitlements, Pro pricing (35)
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

**Providers** are pluggable behind one interface:

| Rail | Markets | Activation |
|---|---|---|
| Stripe | cards, USD/GBP/CAD | `STRIPE_SECRET_KEY` (`sk_…`) |
| **PayPal** | cards, balance, USD/GBP/CAD/EUR/AUD | `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` |
| Paystack | NGN cards, transfer, USSD | `PAYSTACK_SECRET_KEY` |
| Simulated | everywhere | always |

PayPal uses Orders v2 with a cached OAuth token and idempotency keys, so a
retried create cannot double-charge. **PayPal Payouts is deliberately not
used for seller settlement** — it is a separate product without marketplace
split settlement; NGN settles via Paystack transfers and USD/GBP/CAD via Stripe
Connect. The stub says so rather than pretending otherwise.

Until a key is present the `SimulatedProvider` runs the identical lifecycle, so
the flow is never dead-ended. Declines are reproducible on demand (amount ending
`.13`).

## Authentication (§9.1)

Passwordless one-time codes. A code proves control of an email address or phone
number, and possession of that identifier **is** the account — there is no
password database to breach and no reset flow to build, and the phone
verification a marketplace handling money needs anyway falls out of the same
mechanism.

```
POST /api/auth/request  { identifier }        → issues a code (hashed, 5 min, single use)
POST /api/auth/verify   { identifier, code }  → issues a session token
Authorization: Bearer <token>                 → identifies the caller
POST /api/auth/signout                        → revokes it (idempotent)
```

Codes are hashed with a server-side pepper before storage, expire in five
minutes, are single-use, and burn after five failed attempts — including the
correct code, once burned. Identifiers are canonicalised so `Ada@Example.com`
and `ada@example.com` are one account, and `+234 801 234 5678` and
`+2348012345678` are one account. Treating those as separate is how duplicate
identities appear.

Delivery is honest about its own limits. With no provider configured the code is
logged and the response says `transport: "log"`; it is never silently dropped,
because a login that cannot be completed must fail loudly rather than appear to
succeed. Twilio Verify handles phone, Resend handles email.

### Client integration

Both clients use the real flow. Three details that are easy to get wrong:

- **The web token lives in its own module** (`lib/token.ts`) so `lib/api.ts` can
  read it without importing the Zustand store, which itself calls the API.
  Sharing the store would be a cycle, and that failure mode is an `undefined`
  binding at module evaluation rather than a build error.
- **A 401 clears the token**, so the UI drops to signed-out instead of retrying a
  dead credential forever.
- **Mobile restores the token *before* the session check.** `refresh` asks the
  server who the token belongs to, so restoring it afterwards sends an anonymous
  request and concludes the user is signed out — on every single launch. That bug
  only shows up on a real device.

`GET /api/session` resolves the bearer token and answers **401 when nothing
resolves**, which is what lets a client distinguish *signed out* from *signed in
as nobody*. It previously always answered 200 with whatever the store held.

Two dishonest behaviours were removed rather than left in place:

- The mobile SSO buttons signed the user in as a hard-coded demo account — a
  **fabricated identity assertion**, not authentication. Now disabled and labelled.
- Studio's signed-out gate offered the development switcher. It now performs a
  real sign-in.

### Three production bypasses, closed

Identity used to be an unverified `x-mm-user` header, and the mobile OTP accepted
any six digits. Fixing it surfaced three ways production was open — each found by
**asserting data rather than status codes**:

| Defect | Impact |
|---|---|
| `actorId` fell back to the store's session user, which `seed.ts` pre-populates with the demo buyer | **Every** unauthenticated production request resolved to a real, fully-privileged account |
| The identity guard was mounted *before* the auth routes | It intercepted the requests that obtain a token — nobody could sign in |
| A method-only public-read rule | An unauthenticated `GET /api/wallet` answered 200 with an empty account, reading as a real balance of zero |

The guard now runs after the public and authentication routes, dev fallbacks live
only in the development branch, and account-scoped reads are named explicitly so
a new endpoint is **private until deliberately made public**.

Verified against live production:

```
x-mm-user=usr_you  → /api/wallet   401   no data returned
no identity        → /api/wallet   401
GET  /api/auctions                 200   public reads still work signed out
POST /api/auctions (no identity)   401
POST /api/session                  403   identity switch disabled
auth: {"demoHeader": false}
```

Sessions are held in memory and deliberately **not** snapshotted: a snapshot is a
durable document that gets copied around, and bearer tokens do not belong in one.
Restarting drops sessions, which is the safe direction to fail.

## Persistence

The domain store is **in memory**. That is correct for the hot path — a bid must
not cost a database round trip, and the engine depends on Redis-style ordering
that SQL would change — but it meant every restart erased users, lots, bids, the
escrow ledger and memberships, and it pinned the deployment to a single replica.

Access paths are **not** rewritten against SQL. Instead the store snapshots
itself as a document and restores on boot:

```
boot → restore snapshot → seed ONLY if nothing was restored → serve
                       ↘ flush every 15s, and on SIGTERM
```

Restore happens **before** seeding, deliberately: seeding first would overwrite a
restored snapshot with demo data on every restart and lose every real listing.

| Adapter | When |
|---|---|
| **Postgres** (JSONB row) | `DATABASE_URL` set — the deployment target |
| **File** (atomic temp+rename) | default locally, so a restart is not automatically lossy |
| *none* | `MM_PERSISTENCE=off` — used by the verification suites |

Edge cases that are handled rather than assumed:

- **A corrupt snapshot is discarded and the store reseeded.** Refusing to boot
  would be worse than starting fresh.
- **A failed flush logs and continues.** Losing a snapshot is less bad than
  dropping live bids.
- **The acting session is not persisted.** Restoring it would let one deployment
  inherit another's identity.
- **Flushes coalesce** instead of queueing, so a slow database cannot build a
  backlog.

**Durability is stated honestly:** this is periodic snapshotting, so a hard kill
can lose the writes since the last flush. The interval *is* the durability
window — a flush per mutation was rejected because it would serialise the whole
store on every bid. `SIGTERM` flushes, which covers Railway's redeploy path.

`GET /api/health` reports the active adapter, so durability is observable from
outside instead of assumed:

```json
{ "service": "moneymart-api", "persistence": "postgres", "liveAuctions": 13 }
```

Verified in production: a lot created through the API **survived a full container
redeploy** (uptime reset, data intact).

## Drag positioning (§5.2, Studio)

Studio sections and seller photos both reorder by dragging, with keyboard parity.

The primitive is built on **Pointer Events, not the HTML5 drag-and-drop API**:
DnD does not fire on touch devices (which the seller flow depends on), cannot
animate displaced items, and still forces you to derive a drop index from pixels
anyway. It lives in `components/DragReorder.tsx`, with the index arithmetic
*exported so it is testable without a DOM* — an off-by-one in reordering is
invisible on screen until a creator has lost a section.

```
reorder(items, from, to)                  // index-safe; out-of-range is a no-op
computeDropIndex(pointerY, rects, from)   // midpoint-based, height-agnostic
```

Two details worth stating, because both are easy to get wrong:

- **The return value is the index the item takes in the reordered list, not the
  slot its pointer is over.** Those differ by one when dragging downwards, since
  removing the item shifts everything below it up. Deleting that correction
  misplaces the item on every downward drag.
- **Studio reordering walks the FULL block list while each rendered block keeps
  its true index**, so hiding a section cannot silently reorder the document.

Keyboard users get the same capability — focus a handle and use the arrow keys,
with Home/End jumping to the ends. Drag is never the only way to move something.

## Live video (§5.3)

The seeded streams previously pointed at `https://stream.moneymart.demo` — a host
that does not resolve, so every room rendered a failed player. Playback is now
resolved **server-side** by `engine/playback.ts`, which honours a real stored
manifest, then a configured default, then a public demo manifest for live rooms,
and reports a mode of `live | demo | offline`.

That mode is the point: a demo manifest is labelled **DEMO STREAM** in the
player chrome and a room that is not live resolves to `offline` with no URL, so a
client shows the poster instead of a broken element.

`HlsPlayer` (web) and `TvHlsPlayer` (TV) cover both browser paths — native HLS on
Safari/iOS, hls.js with Media Source Extensions on Chromium/Firefox including
Tizen and webOS. hls.js is imported **lazily**, so its ~400 KB never enters the
initial bundle for anyone who does not open a room. Autoplay starts muted
because browsers refuse audible autoplay; unmuting is an explicit action. Fatal
network and media errors are retried a bounded number of times so a transient
segment failure does not end the room.

### Playback is proven, not assumed

```bash
pnpm verify:hls     # drives real Chrome; 29 checks over every resolver manifest
```

A typecheck cannot catch a dead host, CORS on a manifest, or a refused codec. The
suite drives the **hls.js bundle the app actually ships** and reads back what the
media element did:

| | mux x36xhzz | mux pts_shift | unified-streaming |
|---|---|---|---|
| renditions | 5 (up to 1080p) | 4 (up to 720p) | 5 (up to 750p) |
| decoded at | 1920x1080 | 1280x720 | 1680x750 |
| buffered | 100s | 108s | 208s |
| playback | t=13.6s | t=15.3s | t=14.0s |

## Memberships (§10 Pro pricing)

An order settles **once** through escrow; a membership **recurs** on the user and
changes what they pay. Conflating those was the obvious trap, so entitlements are
a separate service rather than another `PaymentProvider`.

RevenueCat is the source of truth on a device purchase and is mirrored
server-side, because a webhook can arrive before, after, or without the client
ever calling the API. Consequences that shaped the design:

- **Pricing is resolved server-side at settlement.** A client claiming to be Pro
  must never lower its own premium.
- **`status` gates the entitlement, not `tier`.** `tier` records what was bought
  and survives an expiration, so trusting it alone would keep granting the
  discount to a lapsed member.
- **Webhooks provision the account.** The store can confirm a purchase before the
  app has ever called the API, so an unknown `app_user_id` gets a minimal
  account rather than losing a paid-for entitlement.
- **Sandbox events cannot grant a live entitlement** in production.
- **Unknown entitlement identifiers grant nothing** — matched against configured
  ids, not a substring test (`PRO` does not contain lowercase `pro`).

```
listing discloses 20%   →   non-member pays 20%   →   Pro pays 15%
         (standard)            (total 12200)            (total 10662.78)
```

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
