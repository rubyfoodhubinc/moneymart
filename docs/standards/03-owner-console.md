# 3. Owner console

The admin dashboard where the Owner runs the app. Goal: less manual coding — most changes become settings the Owner flips or the President proposes.
Reference: `services/api/src/ai/access.ts`, `registry.ts`, `routes.ts`.

## 3.1 Who gets in

| Rank | Who | Tabs |
|---|---|---|
| `owner` | Emails listed in the owner env (MoneyMart: `MM_OWNER_EMAILS`), or accounts with role `owner`. Outside production only, the seeded admin also counts. | All |
| `executive` | Granted by an owner | Granted tabs, never owner-only ones |
| `manager` | Granted by owner/executive | Granted tabs |
| `support` | Granted | Granted tabs |
| `analyst` | Granted, read-only use | Granted tabs |

Rules:

- Owners are set on the server, never from the console.
- You can only manage people below your rank, and only give tabs you have yourself.
- **Owner-only tabs:** `president`, `team`, `audit`, `providers`.
- Anyone without a seat gets **404**, not 403, so the console's existence is not confirmed.
- In production with no owner email set, nobody gets in (fail closed).

## 3.2 Tabs

| Tab | Shows |
|---|---|
| `overview` | Revenue (sales, fees), operating cost (providers, AI), net; members, new members, partners/sellers, live activity, approvals waiting, open tickets |
| `revenue` / `costs` | Detail by day and source |
| `users` | Every account: profile, role, verification, location, everything they bought/sold, payments, tickets, notifications sent, local-AI summary (with consent) |
| `sellers` | Partner/seller accounts and their standing |
| `approvals` | Verification, gated items, the President's drafts |
| `orders` | Every transaction, under its users |
| `tickets` | Support inbox |
| `notifications` | Automatic rules and manual sends (in-app, push, email). Mass sends are approvals |
| `providers` | Every provider and supplier: configured or not (never the key), health, cost this month, switch where a backup exists |
| `settings` | The settings registry |
| `team` | Console access grants |
| `audit` | Every admin and AI action |
| `president` | Chat with the President, approvals, reports, members' requests, staff, boardroom |

An app MAY add tabs (MoneyMart adds `shows`). It MUST keep the four owner-only tabs owner-only.

## 3.3 The settings registry

Every changeable thing is a typed setting, not code:

```ts
{ key: 'features.buy_now', label: 'Buy It Now', group: 'features', defaultValue: true, check: bool }
```

- Each setting has its own check (on/off, whole number in a range, text up to N characters, list of known ids, object).
- `checkChanges(changes, byPresident)` validates a whole set or refuses the whole set with a reason. With `byPresident = true` it also refuses locked keys.
- `applyChanges` writes them. Values live in the store and apply on the next request; no redeploy.
- Every direct change by a console user is audited with before and after.

Standard keys every app SHOULD have: `features.<local_ai>`, `president.name`, `president.brief_hour_utc`, `ai.seats`, `ai.prices`, `ai.budgets`, `notifications.*`.

## 3.4 Audit

`{ id, at, actor, action, target, detail }`, newest first, capped (MoneyMart: 20,000 rows). Writing the audit never breaks the action it records.

Standard actions: `settings_change`, `president_approve`, `president_deny`, `president_apply_failed`, `president_briefing`, `team_grant`, `team_revoke`.
