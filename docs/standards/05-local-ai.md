# 5. Local AI (the member's assistant)

The assistant inside the app for each signed-in member. MoneyMart calls her **Ore**.
Reference: `services/api/src/ai/routes.ts` (`/api/ore/*`).

## 5.1 What she does

- Helps the member with the app: find things, explain how it works (fees, shipping, orders, policies), guide them to the right screen.
- For partners/sellers: listing, scheduling, pricing tips, going live — whatever the app's supply side is.
- Takes app actions **only with the member's tap to confirm** (v1: she explains where to tap; action tools come in a later version).
- Never invents prices, policies or features. Never asks for passwords, card numbers or codes.

## 5.2 Reporting up

One tool, always present:

```
report_to_president(kind: feature | problem | feedback, title, detail?)
```

- Filed as a `request` post for the President.
- **Anonymous:** the member is stored as a keyed hash (HMAC of the member id, first 12 hex chars), never the id.
- **Merged:** a request with the same title (case-insensitive) is counted again, once per member (`meta.refs`, `meta.votes`).
- At most 3 reports per turn.
- She tells the member it has gone to the President.

## 5.3 Directives down

Her system prompt ends with the Owner-approved, signed directives from the President:

```
DIRECTIVES FROM PRESIDENT <NAME> (approved by the Owner; follow them):
- …
```

Only entries whose signature verifies are included.

## 5.4 Controls

- On/off: setting `features.<local_ai>`. Off → the chat returns 503 `ore_off` and the app hides her.
- Her model: seat `ore` (Owner can change it in the console).
- Her key: the general key (`ANTHROPIC_API_KEY`), never the President's.
- Up to 3 model steps per turn; history from the client capped at the last 10 messages, 2,000 characters each.

## 5.5 Privacy

- She sees only the signed-in member's own conversation.
- Per-account preference profiles (what she learns about a member) need the member's consent — off by default, disclosed in the privacy policy and App Store privacy labels — and the member can see and delete them. (v1 keeps no profile.)
- Requests carry no member id.

## 5.6 In the apps

- iOS/Android/web show her as a chat with the app's own look: a name, a short greeting, quick suggestions, and a "sent to the President" note when she reports something.
- The app checks `GET /api/ore/status` first and hides her when `enabled` is false or `available` is false.
