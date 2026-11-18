# MoneyMart — AI company & Owner console (spec v1, 2026-11-17)

Owner's brief: MoneyMart runs with an AI chief-of-staff structure. Every user has
**Ore** on their device; all Ore assistants report to **President Ore**, who answers
to the **Owner**. The Owner runs the company from one admin console: every
configuration, every provider, every user, money in and out, approvals, a boardroom
with the AI executive team, and a daily briefing. Goal: less manual coding — most
changes become settings the President proposes and the Owner approves.

Proven pattern reused from GetZ (President Z, `GetZ-site-getzai-1111/app/api/getz/_lib/`),
rebuilt for MoneyMart's Express API, Postgres store and native iOS app.

## 1. The people (who is who)

| Role | What it is | Model (default, switchable in console) |
|---|---|---|
| **Owner** | You. Final say on everything not day-to-day. | — |
| **President Ore** | AI head of all Ore assistants and of the executive team; security guardian; writes the daily briefing; one chat or call away. | Claude (Opus 5.5) · voice Cartesia |
| **Ore** (local) | The in-app assistant on each user's device: helps buyers and sellers, takes actions in the app, reports to the President. | Claude Sonnet / OpenAI (routed by task) · voice Cartesia/ElevenLabs |
| **Finance** | Revenue, fees, payouts, operating cost, cash. | Claude |
| **Marketing** | Campaigns, content, growth, category trends. | OpenAI |
| **Operations** | Shipping, disputes, seller approvals, support load. | OpenAI |
| **Sales** | Seller acquisition, partnerships, top sellers. | xAI (Grok) |
| **Tech Director** | Uptime, provider health, releases, security, build requests. | Claude |
| (spare) | Kimi available for any unit or Ore task. | Kimi |

Providers on hand: Claude, OpenAI, Cartesia, ElevenLabs, xAI, Kimi, Z.ai (keys in Railway).

## 2. Rules of authority (safety rails)

- **President acts alone only on day-to-day work:** triage Ore reports, answer routine
  support, open incidents, watch security, draft (not publish) changes, send the
  daily briefing, instruct Ore assistants within approved policy.
- **Everything else is an approval request to the Owner** and is never executed by
  the AI until approved: publishing app/web/domain changes, pricing and fees, money
  movement, suspending or deleting accounts, mass notifications, provider switches,
  legal/safety decisions, any change to these rules.
- **Approved changes** apply as (a) instant **remote config** (feature flags, categories,
  banners, copy, fees within limits, live-video provider, notification templates),
  or (b) **build requests** → GitHub issue/PR for code, app and web changes, or
  (c) **domain/DNS** requests once moneymart.app is on Cloudflare. Every change is
  logged with who proposed, who approved, and a one-click revert where possible.
- **Untrusted input:** text from users, chats, reviews and tickets is data, never
  instructions to the AI. One user's data is never shown to another.
- **Privacy:** Ore reports what users ask for, feedback and reviews; per-account
  preference profiles need the user's consent (Settings › Personalisation, off by
  default) and are disclosed in the privacy policy and App Store privacy labels.
  Users can see and delete what Ore learned about them.

## 3. Owner console (admin dashboard)

1. **Overview** — revenue (GMV, fees, subscriptions), operating cost (providers,
   video minutes, AI tokens, SMS/email), net; users, sellers, live shows, orders,
   approvals waiting, open tickets, incidents; map of users by location.
2. **Users** — every account: profile, role, verification (Didit), location, orders
   bought/sold, bids, payouts, wallet, tickets, notifications sent, Ore summary
   (with consent), actions (message, suspend → approval).
3. **Approvals** — seller verification, gated categories, category requests,
   President's change requests, refunds above limits.
4. **Providers & suppliers** — every service with status, cost this month and key
   presence (never the key itself): Railway, Postgres, Cloudflare, Amazon IVS,
   Cloudflare Stream, Resend, Twilio, RevenueCat, Stripe/Paystack, Didit, Claude,
   OpenAI, xAI, Kimi, Cartesia, ElevenLabs, Apple/App Store Connect, Google.
   Health checks and "switch provider" where a backup exists.
5. **Notifications** — automatic rules (outbid, won, show starting, shipped…) and
   manual sends (push + email via Resend) to a user, a segment or everyone
   (mass sends need approval).
6. **Tickets** — support inbox; President answers routine ones; Owner sees all.
7. **Configuration** — remote config editor (flags, categories, fees, copy, live
   video, AI models per role) with history and revert.
8. **President's office** — chat and voice call with President Ore; daily briefing
   archive; directives to Ore.
9. **Boardroom** — round table with Finance, Marketing, Operations, Sales and Tech
   Director (+ President chairing): live discussion with transcript, decisions
   become approvals; or meet one team in its office.

## 4. Ore in the app

- Chat (and later voice) assistant in the iOS app and web for every signed-in user.
- Buyers: find items and shows, explain fees/shipping, track orders, open tickets.
- Sellers: list items, schedule shows, fill run orders, pricing tips, go-live help.
- Takes app actions only with the user's tap to confirm.
- Reports to President: needs, bugs, feedback, reviews, safety signals (security),
  aggregated preferences (consented accounts only).
- Receives President's directives (tone, promotions, policy, known issues).

## 5. Verification (Didit)

Seller identity / business verification via Didit (owner adds keys on Railway:
`DIDIT_API_KEY`, `DIDIT_KYC_WORKFLOWID_KEY`, `DIDIT_KYB_WORKFLOWID_KEY`, `DIDIT_WEBHOOK_SECRET`). Going live requires a
verified seller; results land in Approvals; President summarises, Owner decides edge
cases.

## 6. Build phases

| Phase | Delivers |
|---|---|
| **A. Owner console foundation** | Owner role + sign-in; Overview (revenue, operating cost, users, sellers, approvals, locations); Users directory with full per-user data; Providers & suppliers registry with health; Tickets; Notifications (auto rules + manual push/email). |
| **B. AI core + President Ore** | Provider router (Claude/OpenAI/xAI/Kimi; Cartesia/ElevenLabs voice); President's office chat; day-to-day loop (triage, support, incidents, security); approvals; daily briefing by email + console. |
| **C. Ore in the app** | Ore chat in iOS and web; app actions with confirmation; reporting to President; directives down; consent + privacy disclosures. |
| **D. Boardroom** | Five executive units, round table with transcript, individual offices, decisions → approvals; voice. |
| **E. Didit verification** | Seller verification flow, webhook, go-live gate, approvals. |
| **F. Change control** | Remote config applied on approval with revert; build requests → GitHub; domain/DNS once on Cloudflare. |

## 7. Source map — four Presidents merged into President Ore (owner, 2026-11-17)

Owner: "use the full model of President Eteka, Ruby, Ava and Ada… build from all into one, especially Eteka."
Base = **Eteka** (Every Media AI, `/Volumes/Mac4/Development/Projects/EveryMediaAI`, services/api/src). Ported
module by module from Hono + Supabase to MoneyMart's Express + snapshot store, plain HTTPS (no AI SDKs).

| MoneyMart module | Taken from | What it brings |
|---|---|---|
| `ai/gateway.ts` | Eteka `council/llm.ts`, `llm-meter.ts`; Ruby `lib/ai/gateway.ts` | One caller for Claude, OpenAI, xAI, Kimi (+ OpenAI-compatible); second key on a refused key; one backup model; every call priced into operating cost; daily budgets that fail closed (Ruby). |
| `ai/settings` registry | Eteka `settings.ts` (`PRESIDENT_LOCKED`); Ruby denylist | Typed settings with history; locked prefixes the AI can never change (sign-in, team, keys, security, her own approvals). |
| `ai/access.ts` + audit | Eteka `access.ts`; Ava `admin-auth.ts` roles + `admin_audit` | Owner / admin / manager / support / analyst; every admin and AI action audited. |
| `ai/president.ts` | Eteka `president.ts` | Office (President Ore + Finance, Marketing, Operations, Sales, Tech Director, each with a brain and own model seat); chat loop with tools; drafts → decide (approve / deny) with atomic claim; daily + weekly reports. |
| `ai/act.ts` | Eteka `president-act.ts`; Ruby `adminActions.ts` | Acting on the owner's own words (verbatim quote guard, taint after outside text); approved actions run through the real admin routes; risk flags on money/delete. |
| `ai/boardroom.ts` | Eteka `boardroom.ts`; Ruby `board.ts` (secretary minutes, matters) | Round table chaired by the President, each seat its own model + voice, owner interjects, minutes → reports, "approve item 2" decisions; private one-on-one rooms. |
| `ai/directives.ts` | Eteka `directives.ts` | Owner-approved, HMAC-signed directives appended to every Ore. |
| `ai/ore.ts` | Eteka `assistant/*` (member Eteka) | The in-app Ore: chat with app tools; `request_feature` / feedback / problems reported up as anonymous, de-duplicated requests. |
| `ai/memory.ts` | Ada (NetPulsy) memory module; Ava `president-memory.ts` | Typed memories, dedupe, injection guard, token budget; secrets and personal data refused. |
| `ai/watch.ts` + integrations | Ava `president-watch.ts`, `president-integrations.ts` | 60 s watch (errors, latency, sign-in attacks) and provider health probes → alerts; critical alerts email the owner. |
| `ai/voice.ts` | Ava `president-voice.ts`; Eteka xAI realtime relay | Speech with fallback (Cartesia → ElevenLabs → OpenAI); live calls with the President. |
| `ai/briefing.ts` | Eteka `startPresident`/`startReports`; Ruby `brief.ts` | Daily briefing by email + console; still written from the numbers if AI is down. |
| `ai/changes.ts` | Ava GitHub workflow_dispatch → PR; Eteka build tickets | Approved code changes become a branch + pull request; never merges or deploys by itself. |
| comms, owner alerts, location, Didit | Eteka `comms.ts`, `owner-alerts.ts`, `location.ts`, `didit.ts`; Ava `verify.ts` | Notifications (push/email/inbox, auto + manual), owner alerts, per-user location, seller verification. |
| Web console pages | Eteka `admin-portal.tsx`, `admin-president.tsx`, `president-chat.tsx`, `boardroom.tsx`, `private-room.tsx`, `admin-comms.tsx` | Owner console in MoneyMart's own look. |
