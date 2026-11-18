# 8. Member verification and notifications

Version 1.3. Reference implementation: MoneyMart `services/api/src/engine/verification.ts`, `engine/notify.ts`,
the iPhone `Features/Profile/VerificationView.swift` and `Core/PushManager.swift`, and the console's Messages and Seller checks tabs.
Test: `scripts/verify-notify.mjs` (60 checks).

## 8.1 Identity checks (Didit)

- The member is sent to the provider's **hosted page**. The app MUST NOT collect, upload or store ID documents or selfies; the server keeps only the session id, the provider's status word, a short reason and dates.
- Two workflows: **person** (KYC: document, selfie, liveness) and **business** (KYB). The default comes from the seller's setup answers (individual or business); the member can choose.
- Keys live on the server only: `DIDIT_API_KEY`, `DIDIT_KYC_WORKFLOWID_KEY`, `DIDIT_KYB_WORKFLOWID_KEY`, `DIDIT_WEBHOOK_SECRET`. The provider's session token MUST NOT reach any client.
- Starting again while a check is pending MUST resume the same session (no duplicates).
- The outcome arrives two ways; either is enough:
  1. **Signed webhook** — reject unless the timestamp is within 5 minutes and an HMAC-SHA256 signature matches (raw body, or sorted-key canonical JSON); the session MUST be one this server opened, for the same member (`vendor_data`); repeated `event_id`s are ignored.
  2. **Refresh on return** — when the member comes back to the app, the server reads the decision from the provider with its own key.
  A request body is never trusted as the outcome.
- Status mapping: Approved → `verified`; Declined → `rejected`; Not Started / In Progress / In Review / Resubmitted / Awaiting User → `pending`; Expired / Abandoned / anything else → `unverified` (can start again).
- A late, out-of-order event MUST NOT undo a pass (only an explicit expiry of the check may).
- Levels: a person pass is level 2, a business pass level 3.
- The member is notified when the check goes to review, passes, is declined, or expires unfinished.
- Owner switch `sellers.verification_required` (default off): when on, an unverified seller is refused with `verification_required` before scheduling shows.

Routes: `GET /api/verification`, `POST /api/verification/start {kind?}` → `{url, verification}`, `POST /api/verification/refresh`, `POST /api/webhooks/didit`, `GET /api/admin/verifications` (tab `sellers`).

## 8.2 Notifications: one delivery path

- Every notification is created in one place (the inbox) and delivered by one listener: a **live banner** over the socket (`notification` on room `user:<id>`), then a **push** to each registered phone when the member's switch for that kind is on. Call sites MUST NOT emit their own copies.
- Switches (member Settings): `outbid` (bids), `streamStart` (shows), `orderUpdates` (orders), `marketing` (offers). Account and safety messages always go through. The inbox keeps everything except offers to members who switched offers off.
- Automatic alerts: outbid; show you saved is live; you won; your lot sold; paid — ready to ship (seller); shipped with tracking, delivered (buyer); funds released; membership; verification. A status saved twice MUST NOT alert twice.

## 8.3 iPhone push (APNs)

- Keys: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (.p8 text), optional `APNS_TOPIC` (bundle id). ES256 provider token, refreshed every 40 minutes, HTTP/2 to `api.push.apple.com` (TestFlight/App Store) or the sandbox host (debug builds register as `sandbox`).
- Payload: `aps.alert {title, body}`, `sound`, `badge` = unread count, `thread-id` = category, plus `href` (app path) and `id`.
- `POST /api/devices {token, env}` registers the signed-in member's phone (hex token, at most 10 per member); `DELETE /api/devices/:token` only for the owner of the token. Tokens Apple answers 410 / BadDeviceToken are dropped.
- The app asks permission only when the member taps **Turn on** (never at launch); registers after sign-in if already allowed; unregisters on sign-out; shows banners while open; a tap opens the notification's screen.

## 8.4 Owner messages

- `GET /api/admin/notify` → delivery status, audience counts (everyone, buyers, sellers, verified sellers, Pro), history. `POST /api/admin/notify {title ≤80, body ≤600, audience, kind: announcement|marketing, href?, preview?}`; one member by `member:<handle or email>`.
- Links MUST be app paths (`/…`), never outside URLs. Offers are titled `Offer: …` and skip members who switched offers off. `preview: true` counts recipients without sending; the console shows Review → Send to N.
- Every send is audited (`notify.send`). Tab grant: `notifications`.
