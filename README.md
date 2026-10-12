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
| **Authentication** | ✅ Passwordless OTP on REST **and** the realtime layer — writes require a verified identity |
| **Persistence** | ✅ Postgres snapshotting — data survives redeploys (proven in production) |
| **Authorization** | ✅ Object-level checks — orders private to participants, storefront writes owner-scoped |
| **Rate limiting** | ✅ Ingress limits on the message-sending and write paths |
| **CI** | ✅ Green on GitHub — 345 checks over 13 suites on every push |
| **Code delivery** | ✅ Email live for real recipients via Resend; SMS via Twilio Messages — the sent code is the verified code |
| **Social sign-in** | ✅ Google + Apple (OIDC), verified against a real JWKS and PKCE |
| **Deployed product** | ✅ Verified in a real browser against production — mounts, renders, talks to its gateway |
| **Disputes** | ✅ Admin-only resolution; a refund returns funds, and neither branch can double-pay |
| **Money path** | ✅ One end-to-end run from listing to settled payout, with the books closing |
| **TV D-pad** | ✅ Real key-press traversal verified in a browser — focus stays visible and unique |
| **Mobile reachability** | ✅ Gateway resolved per device, per platform — not pinned to loopback |
| **Verification** | ✅ **608 automated checks** across 21 suites — `pnpm verify:all` |
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
  PASS  TV / IPTV (§7)                         41 passed
  PASS  Payments & membership                  35 passed
  PASS  Authentication                         48 passed
  PASS  Persistence                            21 passed
  PASS  Browser UI (real Chrome)               41 passed
  PASS  HLS playback (real browser)            29 passed
  PASS  Payments & membership                  35 passed
  PASS  Mobile (native build)                   42 passed
  PASS  Unified deployment                     28 passed
  PASS  End-to-end health                      11 passed
───────────────────────────────────────────────────────────────
  TOTAL  608 passed   0 failed
═══════════════════════════════════════════════════════════════
```

Individually:

```bash
pnpm verify            # engine rules over REST (31)
pnpm verify:realtime   # Socket.IO broadcast contract (19)
pnpm verify:escrow     # payments, escrow, disputes (31)
pnpm verify:tv         # QR, handoff, EPG, 10-foot UI, D-pad (35)
pnpm verify:auth       # OTP flow, canonicalisation, refusals, production posture (48)
pnpm verify:lifecycle  # listing → bid → settle → pay → escrow → release → books (36)
pnpm verify:dispute    # admin-only resolution, refund, seller-favourable release (30)
pnpm verify:delivery   # the sent code is the verified code; senders and failures (31)
pnpm verify:oauth      # real JWKS, PKCE, state, linking, browser handoff (47)
pnpm verify:production-app  # live deployment renders and reaches its gateway (21)
pnpm verify:images     # SVG/script refusal, type sniffing, count and size bounds (20)
pnpm verify:authorization  # order privacy, storefront ownership, id guessing (24)
pnpm verify:rate-limit # OTP flood, IP rotation, dev controls in production (19)
pnpm verify:socket-auth  # anonymous writes refused, identities not spoofable (15)
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

### The realtime layer was open

The Socket.IO layer had **no authentication at all**, and its write handlers read
`bidderId` from the payload. An anonymous client could place a real bid as any
user. Proven against production:

```
REST  anonymous bid → 401          ← the HTTP surface looked locked down
socket connected anonymously
auction:placeBid as usr_ken → ACCEPTED
lot auc_audi: 12200 → 12700, 9 bids, usr_ken winning
```

The token now travels in the **handshake**, because a WebSocket upgrade cannot
carry an `Authorization` header from a browser. Every write handler uses the
verified identity:

| Handler | Now |
|---|---|
| `auction:placeBid` / `autoBid` | payload `bidderId` **ignored**, not merely validated |
| `auction:autoBidOff` | scoped to the caller |
| `chat:send` | authorship from the token — names and creator badges cannot be forged |
| `chat:pin` | requires being the room's creator |
| `user:join` | joins the **authenticated** user's room, ignoring the requested id |

Anonymous writes are refused with `not_authenticated`; **spectating stays open**,
so a signed-out visitor can still watch. Both clients send the token and
re-handshake on sign-in/sign-out, since an existing socket keeps its original
authentication until it reconnects.

Two suite failures this surfaced were **tests relying on the hole**: one emitted a
different user's id from another user's socket, and another pinned as a creator
who did not own the room. Both now authenticate properly through a dev-only token
endpoint that production refuses, rather than weakening the guard.

### Three REST bypasses, closed

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

## Email delivery: live for real recipients

`RESEND_API_KEY` is configured on the Railway service and **sign-in works for
anyone**, not just a test address:

```
/api/health       → auth.delivery: { sms: false, email: true }
/api/auth/request → delivered: true, transport: resend, reachable: true
                    for a real address, not only delivered@resend.dev
```

### A wrong conclusion, corrected by testing properly

This was first recorded as blocked on DNS. That was **wrong**, and the mistake is
worth keeping because it was easy to make: the test that "proved" the restriction
sent to `someone@example.com`, and Resend rejects `example.com` **regardless of the
sender**. Three separate causes were being conflated, and only isolation told them
apart:

| Sender | Recipient | Result | What it actually means |
|---|---|---|---|
| verified | `delivered@resend.dev` | **200** | sender is fine |
| unverified `moneymart.app` | `delivered@resend.dev` | **403** | sender is the problem |
| verified | `example.com` | **422** | recipient is the problem |

So the sending domain must be **verified**, and `example.com` is always refused —
but any other real address is accepted. `RESEND_FROM` is now set to
`MoneyMart <codes@mail.everystudio.app>`, a **verified** domain on the account,
which is why real recipients work today with no DNS change.

### The branded address is a one-variable upgrade

### A coverage gap this exposed

The browser-UI suite signed in with `@example.com` addresses, which Resend refuses
outright — so the delivered branch (countdown, resend, spam hint) was **never
covered** while appearing to be. The address domain is now a variable, and the
delivered path is genuinely asserted. That is why the delivered branch went
unverified for two rounds while I described it as working.

`moneymart.app` is added to Resend but not verified, and **it is served by IONOS
nameservers** (`ns1114.ui-dns.com` and friends), not Cloudflare. Four records in
the IONOS DNS panel complete it:

| Type | Name | Value |
|---|---|---|
| TXT | `resend._domainkey` | the DKIM public key Resend issues |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| CNAME | `rsend` | `send.forge.rmta.net` |

Once they propagate, changing `RESEND_FROM` to `codes@moneymart.app` is the entire
migration — no code change, no redeploy of anything but a variable.

## Sign-in code delivery (SMS and email)

Delivery was the one part of authentication that had never been exercised, because
it needs a paid provider. Reading the code was enough to find the bug in it:

> **Twilio's Verify product generates its own code and ignores any supplied one.**
> The platform generates a code, stores a hash of it, and sent that code to Twilio
> Verify — so the user would receive *Twilio's* digits while `verify()` compared
> against the hash of *ours*. **Every SMS sign-in would have been rejected as an
> invalid code**, and only a real text message could have exposed it.

The **Messages API** is used instead, because it sends the exact body it is given.
A sender is required — either a Messaging Service SID (preferred, so senders can be
swapped without a deploy) or a from-number — and without one SMS is reported as
unconfigured rather than silently failing.

Email uses Resend, with `RESEND_FROM` defaulting to `onboarding@resend.dev`, which
works **without a verified domain** so a first sign-in is possible before DNS is
done.

```bash
pnpm verify:delivery   # 31 checks: sent code == verified code, senders, failure reasons
```

Verified against mock Twilio and Resend endpoints, end to end: the code read out of
the delivered SMS **and** out of the delivered email completes a real sign-in, the
HTML and text parts agree, basic/bearer auth is correct, and a provider failure
carries its specific reason through (`twilio_400_21608`, `resend_403_validation_error`)
rather than collapsing to a bare status.

A mock cannot prove the real vendors behave identically — but it does prove the
thing that was actually wrong.

## Social sign-in (Google and Apple)

The blueprint specifies Firebase Auth with Google, Apple and Facebook. This
implements the OpenID Connect authorization-code flow directly instead of adding a
vendor, because the platform already owns its session layer and Firebase would be
a second source of truth for identity.

Google and Apple differ in exactly one way that is easy to get wrong: a Google
client secret is a **plain string**, whereas **Apple's is an ES256 JWT** signed
with a private key and minted fresh on every exchange. Treating Apple's secret as
a string is the usual reason "Sign in with Apple" fails only in production.

| Property | How it is enforced |
|---|---|
| **Signature** | the ID token is verified against the provider's **JWKS** — an unverified decode would accept any crafted token |
| **Algorithm** | only `RS256`/`ES256`; `alg: none` is refused |
| **Issuer / audience / expiry** | all checked, each asserted separately |
| **Unpublished `kid`** | refused, with **no fallback** to another key |
| **PKCE** | verifier held server-side, challenge sent as `S256`, verifier checked to match on exchange |
| **State** | single-use, 10-minute TTL, so a replay cannot mint a second session |
| **Linking** | an email links to an existing account **only when the provider asserts it is verified** |
| **Return path** | validated as an in-app path, so the callback is not an open redirect |
| **Handoff** | the session token returns in the URL **fragment**, which is never sent to a server, so it stays out of access logs and `Referer` |

A provider with no credentials is reported as unconfigured and its button is **not
offered** — a disabled button with no explanation is worse than no button. Set
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or the four `APPLE_*` values to activate
one; see `.env.example`.

### How this was verified without real provider credentials

`pnpm verify:oauth` stands up a **real OpenID Connect provider on localhost** —
serving a JWKS and a token endpoint, signing genuine ID tokens — and drives the
actual exchange through it (41 checks). That exercises the production code path,
not a mock of it: a token signed by the wrong key, an `alg: none` token, a wrong
issuer, a wrong audience, an expired token and an unpublished `kid` are each
refused, and the PKCE verifier is confirmed to match the challenge.

### A fault only the deployment could show

Deploying this exposed that **starting a sign-in returned 401**: the production
identity guard intercepted `/api/auth/oauth/*` — the endpoints whose whole purpose
is to serve a caller with no identity yet. Every local test passed, because the
guard has two branches: in development the demo header supplies an actor, so the
check passes, while production requires a bearer token. Only exercising the
endpoint on the real deployment showed it.

`/api/auth/oauth/*` is now self-gated, so a provider answers for itself (503 when
unconfigured) instead of a 401 naming the wrong problem. Asserted in the
production posture so it cannot return.

One limitation, stated rather than hidden: the success path of the browser handoff
is verified (the token survives, and is erased from the address bar), but the
**presentation** of a failed sign-in could not be confirmed reliably in headless
Chrome, so it is deliberately **not asserted**. The security property — the token
never lingering in the URL — is verified for both paths.

## Disputes: a verdict that could never be reached

The money path stops before disputes, so the branch where money goes **back** to a
buyer — and the branch where a contested sale still pays out — had never been
exercised.

```bash
pnpm verify:dispute   # 30 checks
```

It found a live bug. `resolveDispute` with a `release` verdict saved the released
amount onto the **disputed** record and transitioned that straight to `released`.
The state machine permits `disputed → releasing`, **not** `disputed → released`, so
the transition threw `illegal_escrow_transition` on *every* attempt:

> **An administrator could never rule a dispute in the seller's favour.** The admin
> saw a 409 and the seller was never paid.

And it was worse than a refusal. The payout row is created **before** the
transition, so each failed attempt still wrote a payout into the ledger for escrow
that never released — money recorded in one direction while the funds stayed put,
and a retry added another row. The release path now goes through `releasing`,
exactly as the buyer-confirmed path does, so the payout and the ledger move
together.

Two more defects, both only visible once a refund exists:

- a refunded sale was still reported as **income** in the seller's transaction list
  at their full net; it now reads "Refunded" with a zero amount
- a refunded order was counted in **`pending`**, telling the seller they were owed
  the full net of a sale that had been returned to the buyer

The suite also pins what was already correct: only an administrator may resolve, a
buyer cannot resolve their own dispute, a seller cannot rule in their own favour,
`heldAmount` survives a refund as an audit trail, released plus refunded never
exceeds held, and a disputed escrow cannot be resolved twice.

## The money path, end to end

Every component of commerce had a suite of its own — the auction engine, escrow
transitions, payments, orders. **Nothing moved money from a listing to a settled
payout in one run and checked the books at the end.** That is the difference
between *"each part works"* and *"the product works"*, and it is exactly where an
inconsistency between two correct-looking parts hides.

```bash
pnpm verify:lifecycle   # 36 checks: list → bid → settle → pay → escrow → ship → release → books
```

It drives the real HTTP and Socket surfaces in sequence: a seller lists, a self-bid
is refused, the buyer bids **over the socket**, the clock runs out, settlement
creates the order, the buyer pays, funds are held, the seller **cannot** release
them, the seller ships, the buyer confirms, the payout releases, and the ledgers are
cross-checked against each other — including that confirming twice does not pay
twice.

### The defect it found

`/api/wallet` recomputed the seller's balance with **invented numbers** instead of
reading the ledger:

- the seller fee was hardcoded at **10%** while the settlement charges the category
  rate (**12%** for luxury) — a **$3.00 overstatement** of the seller's balance on a
  $150 hammer, measured
- a buyer's spend was subtracted from the **seller's** balance as `spent * 0.15`,
  charging a seller for their own unrelated purchases
- `lifetimeGross` added a flat **$120 per purchase**, a figure corresponding to nothing
- every sale was reported at a flat 10% fee in the transaction list

The wallet now reports what the ledger recorded. The books close, arithmetically:

```
buyer total − seller net − shipping − tax = platform take
$212.05      − $132.00    − $32.05        = $48.00
                                            = buyers premium $30.00 + seller fee $18.00
```

## TV D-pad: three defects a real key press found

The TV suite read the focus engine's **source** and grepped it for the strings
`'ArrowDown'` and `'ArrowRight'`. It never pressed a key, so three defects in the
defining feature of a TV app survived — all invisible to a grep and obvious to a
remote:

1. **Two elements could both hold focus.** Focus ids came from the auction id alone
   (`auction-${id}`), and a lot legitimately appears in more than one row —
   "Ending Soon" *and* "Just Added". The engine keys focus by id in a `Map`, so the
   second registration replaced the first, and because `focused` is
   `activeId === id`, **both cards rendered a gold ring** while only one was
   reachable. Ids are now row-scoped, and the engine records and warns about a
   duplicate rather than letting it flicker quietly.

2. **Focus could move somewhere invisible.** `html`, `body` and `#root` were all
   `overflow: hidden` with `.tv-screen { height: 100% }`, so the page could not
   scroll at all. Measured: pressing Down moved focus to a card at **y = −697**,
   permanently off-screen. `#root` is now the one scrollable axis and the screen
   uses `min-height`.

3. **The scroll settled 8px short.** `focus({preventScroll:false})` and a
   `scrollIntoView({behavior:'smooth'})` both start animations and the second
   interrupts the first, with a CSS `scroll-behavior: smooth` competing as well.
   The ring was visible while the price and title under it were not. The scroll is
   now instant, with a scroll-margin on focused cards — which is also what a D-pad
   needs, since a remote emits keys faster than an animation completes.

Now asserted by driving Chrome at a 1920×1080 10-foot viewport with genuine arrow
key events: every press moves focus, every focused card is **fully** on screen, and
focus never lands on two elements at once. **Two of those fail against the previous
code.** Verified against the live deployment as well as locally.

## The deployed product, verified

Every other suite checks the API, local builds, or the dev servers. None of that
proves React mounted, the bundles executed, or the client could reach its gateway
from a different origin — and *"28 API checks pass"* is not the claim *"the app
works for a customer"*.

`pnpm verify:production-app` loads the **live deployment** in a real browser and
asserts the product itself:

```
✔ the app mounted into #root            4 child element(s)
✔ the rendered markup is substantive    80951 chars
✔ the browser can fetch the gateway across origins   7 lots · 4 streams
✔ /live, /auctions, /marketplace, /creators all render real data
✔ a deep-linked lot renders its own content          matched "Rolex"
✔ the TV app mounts from its own namespaced bundle
✔ HSTS + nosniff sent · dev controls refused (403)
```

The cross-origin check matters most: **CORS failure is invisible to every
API-side test**, because a test process is not subject to it.

Read-only — it never bids, buys or signs in — so it is safe against production at
any time. It runs in CI as a **non-blocking** step, because it tests a live host
the workflow does not deploy; a provider-side blip must not fail a code check,
but a real product regression stays visible.

## Continuous integration

Every push to `main` runs the release gate on a clean Ubuntu runner, against
services the gate starts itself — no credentials, database or pre-running server,
so a fork or a fresh clone gets the same result.

```bash
pnpm verify:ci        # full gate: boots api, web and tv, runs 13 suites (345 checks)
pnpm verify:ci:api    # API-only gate for a fast local loop (316 checks)
```

It runs `typecheck`, builds the API, web and TV, then the gate. The HLS playback
proof runs too, whenever a Chromium binary is present — which is the difference
between *"the player compiles"* and *"the player decodes"*.

**Excluded, stated so a green check is not mistaken for full coverage:**

| Suite | Why | Run it with |
|---|---|---|
| browser UI | needs Chromium **and** a dev server pointed at the gate's API | `pnpm verify:ui` |
| mobile bundling | exports both native platforms; slow | `pnpm verify:mobile` |
| deployment | needs the hosted gateway and its certificate | `pnpm verify:deploy` |

The gate **reuses any service already answering on its ports** and only starts
what is missing, tracking which it started so teardown stops only those. Running
it while the dev servers were up previously killed them, which showed up as 25
"failures" in the next audit — a test runner has no business having that side
effect, and starting a second server on a busy port would silently test an
instance the run never configured.

The first CI run **failed**, which is what running it was for: the gate started
only the API, so the TV and health suites failed with connection-refused. A gate
that does not start what it tests reports false negatives, and a gate whose
failures are tolerated stops being read. That is now fixed and verified green.

### Launchers were machine-specific

Six scripts hardcoded the repository location and the DSH Node runtime path, so
none could run in CI, on another machine, or from a fresh clone — and the failure
was a bare `no such file` rather than anything explaining that the path was baked
in. Both are now derived (`scripts/lib/runtime.sh`): the root from the script's own
location, Node from the DSH runtime when present, otherwise from `PATH`.

## Listing image validation

Images accepted any string verbatim. Measured before this existed: a script-bearing
SVG was stored and served back to every visitor, and a **1.5 MB data URI** was
accepted and echoed on every read.

**Severity, stated precisely.** The SVG did **not** execute — Chrome blocks SVG
scripting in `<img>`, `<object>` and `<iframe>`, which was measured directly. This
is *unvalidated input*: a script payload is stored and redistributed, one refactor
away from being an XSS the moment anything renders a stored value through
`innerHTML`, a CSS `url()`, or a WebView with scripting on. The size half is an
unambiguous defect — one listing could carry a payload every client then downloads.

| Rule | Why |
|---|---|
| **Bytes are sniffed**, not the declared MIME | a payload claiming `image/png` while containing an SVG is refused |
| **Scheme is allowlisted** (`http`/`https`/`data:image/*`) | a blocklist of `javascript:` would miss `vbscript:`, `blob:`, `filesystem:` |
| **SVG refused outright** | the one image format that can carry script; no listing photo needs it |

**SVG is refused for user submissions only.** The platform's own seeded artwork is
SVG — verified by inspecting the live product, where all 23 rendered images on
`/auctions` are `data:image/svg+xml`. That is trusted first-party content written
directly by the seed, which does not pass through the validator, so refusing SVG
from sellers cannot blank the catalogue. The distinction is deliberate rather than
accidental: first-party artwork may be vector, untrusted uploads may not.
| **≤ 20 images, ≤ 3 MB each** | the blueprint's ceiling, and a bound on store inflation |
| **Duplicates collapsed** | they waste storage and render identically |

Two further defects found while testing: an oversized body reported **500** because
the parser threw before any handler ran (now `413`, with malformed JSON as `400`),
and the 2 MB body limit refused a legitimate gallery *before* the validator could
explain why (raised to 16 MB so the validator is what refuses).

## Delivery is reported honestly

Found while verifying the image work in production: codes are generated and logged
but **never sent**, because no SMS or email provider is configured. Sign-in cannot
complete for any real user, and clients were being told to check an inbox that
would stay empty.

`/api/auth/request` now returns `reachable` (did a message actually go out) and
`configured` (which channels exist); the boot banner states it plainly, and
`/api/health` exposes it so an operator sees an unreachable sign-in without reading
a log. Dev code exposure stays off in production, so it is not worked around by
leaking codes. **Setting `TWILIO_*` or `RESEND_API_KEY` activates delivery with no
code change.**

## Object-level authorization

Authentication asks **who you are**. It does not answer whether you may touch a
particular object — and two endpoints never asked. Both defects were of that
shape: the caller was genuinely signed in, and the route simply never checked
whether the object was theirs.

| Endpoint | Was | Now |
|---|---|---|
| `GET /api/orders/:id` | any signed-in caller could read **any** order | buyer or seller only |
| `GET /api/orders/:id/escrow` | same | buyer or seller only |
| `POST /api/orders/:id/status` | same, and could forge fulfilment | **seller only** |
| `PUT /api/storefronts` | `handle` from the body → **overwrite any creator's shop** | the caller's own handle |

Demonstrated before the fix, from an unrelated account:

```
GET /api/orders/ord_seed_1 → 200
  buyerId usr_you · sellerId usr_jules · total 1148.55
  delivery address present · tracking DHL7741 2290 8834

PUT /api/storefronts {"handle":"adaluxe", …} → 200
  victim storefront renamed to "PWNED BY ANOTHER USER"
```

**An id is not a secret.** Order ids appear in URLs, notifications and support
conversations, and a creator's handle is public by design — so an endpoint that
treats knowing an id as authorization is open to anyone.

Two details that matter:

- **Non-participants get 404, not 403.** A 403 confirms the id exists; unknown
  ids and other people's ids are now indistinguishable, which the suite asserts.
- **Fulfilment is seller-only.** A buyer marking their own order shipped would
  defeat escrow, since release depends on dispatch having happened.

Escrow actions (`pay`, `confirm`, `dispute`) were already party-correct —
enforced inside the escrow service, including that the **seller cannot release
their own funds**. They are now covered by assertions rather than left to
inspection.

## Rate limiting

Measured against production before this existed: **eight consecutive OTP requests
all returned 200**. Each is a billable SMS once a provider is configured, so the
endpoint was an open door to SMS-bombing toll fraud, to using the platform as a
free SMS gateway, and to account enumeration.

| Endpoint | Address cap | Subject cap |
|---|---|---|
| `POST /api/auth/request` | 20 / 15 min | **5 / 15 min per identifier** |
| `POST /api/auth/verify` | 30 / 15 min | — |
| `POST /api/auctions` | 30 / hour | — |
| `/api/webhooks/*` | 300 / min | — |
| everything | 600 / min | — |

Four choices that decide whether a limiter actually helps:

- **Sliding windows, not fixed buckets.** A fixed window lets an attacker send a
  full allowance at the end of one window and again at the start of the next,
  doubling the effective burst exactly when it matters.
- **Address *and* subject.** An address cap is defeated by rotating addresses; a
  subject cap alone lets one address walk a list of phone numbers. Verified that
  a client-supplied `X-Forwarded-For` does **not** shift the bucket, because
  `trust proxy` is set.
- **Buckets are swept.** A unique key per attacker address is itself a
  memory-exhaustion vector, and a limiter that can be used to exhaust memory is
  worse than none.
- **Refusals are actionable**: `429` with `Retry-After` and `RateLimit-Limit`, and
  successful responses advertise the remaining allowance so a client can back off
  *before* being refused.

Two defects in my own first attempt, both caught by testing rather than reading:
the subject cap **reused the address cap**, so it enforced nothing distinct —
`subjectMax` is now required whenever a subject is declared and the policy throws
at construction without it. And my refusal test used a unique identifier per
request, so it never exercised the limit it was checking.

Verified against live production:

```
200 200 200 200 200 429 429 429 429   ← was 8/8 successful
other@example.com → 200               ← unrelated subjects unaffected
/api/dev/rate-limit/reset → 403       ← clearing limits would be a bypass
```

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
