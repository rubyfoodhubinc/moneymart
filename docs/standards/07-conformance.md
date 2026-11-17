# 7. Conformance tests

An app conforms to v1.0 when an automated test, run against a scripted stand-in for the model API (no real key), passes every check below.
Reference: `scripts/verify-president.mjs` (34 checks).

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

## 7.9 Writing the stand-in

The stand-in answers by who is speaking (the start of the system prompt) and what the owner asked (the text after `OWNER:`), returning Messages-API JSON with `content` blocks and `usage`. It records the key on every request so key separation can be checked.
