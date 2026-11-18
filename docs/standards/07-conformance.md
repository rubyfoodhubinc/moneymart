# 7. Conformance tests

An app conforms to a version when an automated test, run against a scripted stand-in for the model API (no real key), passes every check below.
Reference: `scripts/verify-president.mjs` (61 checks: 34 for v1.0, 13 for the v1.1 boardroom, 14 for the v1.2 chief of staff).

## 7.1 Access

- [ ] A member gets 404 on the President's routes.
- [ ] Nobody signed in gets 404.
- [ ] The owner gets every tab.
- [ ] The office has its five department heads.

## 7.2 Numbers

- [ ] `business_report` returns the app's own numbers.
- [ ] The overview has members, transactions and activity.
- [ ] The conversation with the President is kept per thread.

## 7.3 Drafts and approvals

- [ ] A settings change is filed as a pending draft.
- [ ] Nothing changes before approval.
- [ ] Approving applies it.
- [ ] An item can only be decided once (second decide → 409).
- [ ] The President cannot propose changes to locked keys (her own AI settings).

## 7.4 Staff

- [ ] A department head files a draft.
- [ ] Staff keep their own notes.
- [ ] The owner can deny a draft.

## 7.5 Directives

- [ ] A directive waits for approval.
- [ ] Approved directives are signed.
- [ ] The local AI's prompt includes the signed directive.

## 7.6 Local AI reporting

- [ ] The local AI files a member's request.
- [ ] Same requests are merged and counted once per member.
- [ ] Requests do not carry member ids.
- [ ] The President reads member requests, wrapped as data.
- [ ] The owner can switch the local AI off from the console.

## 7.7 Member messages

- [ ] Approval sends it.
- [ ] Members find it in their inbox.

## 7.8 Briefing, settings, audit, cost, keys

- [ ] The daily briefing has her summary and the numbers.
- [ ] Settings are checked by their own rule (bad value → 400).
- [ ] The owner changes a setting directly.
- [ ] Members cannot change settings.
- [ ] Every decision is in the audit log.
- [ ] AI calls are priced into operating cost.
- [ ] Providers show key presence, never the key.
- [ ] The office uses the President key; the local AI uses the general key.

## 7.9 Boardroom (v1.1)

- [ ] The owner moves seats between AI providers.
- [ ] Members cannot open the boardroom.
- [ ] A board meeting opens and the first head starts speaking.
- [ ] Each of the five heads speaks, then the President sums up.
- [ ] Every head speaks in their own voice.
- [ ] The owner interjects; the table answers one round at a time (409 while busy).
- [ ] The table answers the owner with another round.
- [ ] Closing writes the minutes to Reports.
- [ ] Proposals from the meeting wait in approvals.
- [ ] A closed meeting takes no more turns.
- [ ] A private room with one head.
- [ ] Past meetings are listed.
- [ ] Meetings are in the audit log.

## 7.10 Local AI as chief of staff (v1.2)

- [ ] Her bid lookup has the member's real bid, winning, with a link.
- [ ] Ore looks up the member's own bids.
- [ ] The whole platform guide is embedded in her.
- [ ] She sees the member's account as buyer and seller.
- [ ] She has tools for orders, bids, listings, shows, payouts, notifications and the marketplace.
- [ ] Shows come back with links that open in the app.
- [ ] She reads attached photos and PDFs.
- [ ] Text files are read inline, marked as data.
- [ ] Other file types are refused with a reason.
- [ ] At most four attachments at a time.
- [ ] Calls get short spoken answers.
- [ ] Ore reports that her voice is available.
- [ ] Ore speaks with her server voice.
- [ ] Speech is cleaned of markdown and links before it is spoken.

## 7.11 Writing the stand-in

The stand-in answers by who is speaking (the start of the system prompt) and what the owner asked (the text after `OWNER:`), returning Messages-API JSON with `content` blocks and `usage`. It records the key on every request so key separation can be checked.

## 7.12 Verification and notifications (§8)

Run `scripts/verify-notify.mjs`: stand-ins for Didit (HTTP) and Apple Push (HTTP/2) check starting and resuming a check, the decision on return, the webhook (bad signature, stale, unknown session, other member, replay refused), the Owner's verified-only switch, ES256 push tokens, badges, switches, dead tokens, order alerts and Owner messages. 60 checks.
