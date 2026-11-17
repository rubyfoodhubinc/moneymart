# Adopting the standard

For a new app, or for updating an existing app (one with an older President) to v1.0.

## Before you start

1. Pick the names: President _name_, local AI _name_, and the five department heads' names.
2. Write `docs/ai-company-spec.md` in the app: the names, what "business numbers" mean for this app, the member-message audiences, any extra tabs and locked keys, and "Conforms to AI Company Standard v1.0".
3. Owner puts the keys on the host (see [API contract §6.4](06-api-contract.md#64-environment)). Never paste keys into chat or code.

## Server, in this order

| Step | Copy from MoneyMart | Change for your app |
|---|---|---|
| 1 | `ai/gateway.ts` | Store for daily spend; env names |
| 2 | `ai/access.ts` | Owner env name; tab list (keep the owner-only four) |
| 3 | `ai/registry.ts` | Your settings and checks; extra locked keys |
| 4 | Store collections: staff, posts, chat, audit, spend | Your database (tables, or a snapshot store) |
| 5 | `ai/president.ts` | Department heads, business numbers, member-message audiences, prompts in your words |
| 6 | `ai/routes.ts` | Your auth helper; local-AI path and prompt |
| 7 | `scripts/verify-president.mjs` | Your seeded owner and members; your numbers |

Every step keeps the rules in [Roles and authority](01-roles-and-authority.md) as code, not only as prompt text: locked keys checked in `checkChanges`, drafts before actions, atomic decide, signed directives, anonymous requests, 404 for no seat.

## Apps

- **Console (web):** tabs from `/api/admin/me`; President page with chat, approvals (approve / deny), reports, requests, staff.
- **Mobile:** local-AI chat screen; hide it when `/status` says off.

## Updating an app that already has a President

1. Map its modules to the table above; keep what already does the same job — fix in place, no rewrite.
2. Add only what is missing (often: key separation, budgets that fail closed, signed directives, anonymous merged requests, briefing without AI).
3. Run the conformance test; every failing check is the to-do list.
4. Record the version in the app's spec.

## Done means

- Conformance test passes.
- Owner email set on the host; owner signs in and sees the console.
- One real chat with the President using the real key, one approval, one briefing email.
