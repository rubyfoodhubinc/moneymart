# 6. API contract

All JSON. Identity comes from the app's session (bearer token). Console routes return **404** to anyone without access to the tab.

## 6.1 Console

| Method | Path | Tab | Body | Returns |
|---|---|---|---|---|
| GET | `/api/admin/me` | any seat | — | `{ role, tabs[], email, president }` |
| GET | `/api/admin/overview` | overview | — | `{ today, week, month, approvalsWaiting }` (each period: numbers now and previous, members, sellers, activity, `aiCost`) |
| GET | `/api/admin/providers` | providers | — | `{ ai: [{ id, label, configured }], seats: [{ name, provider, model, backup? }], prices, cost30d: { usd, calls, unpriced[] } }` |
| GET | `/api/admin/settings` | settings | — | `{ settings: [{ key, label, group, value, defaultValue }] }` |
| PUT | `/api/admin/settings` | settings | `{ changes: [{ key, value }] }` | `{ ok, changed[] }` · 400 `{ error: 'invalid', detail }` · 403 `owner_only` for `ai.*` by non-owners |
| GET | `/api/admin/audit?limit=` | audit | — | `{ entries[] }` |

## 6.2 President

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/admin/president` | — | `{ name, configured, staff[], approvals[], reports[], requests[], recent[], threads[] }` |
| GET | `/api/admin/president/chat?thread=` | — | `{ lines[] }` |
| POST | `/api/admin/president/chat` | `{ text, thread? }` | `{ reply: line, approvalsWaiting }` |
| POST | `/api/admin/president/decide/:id` | `{ decision: 'approve' \| 'deny' }` | `{ ok, post }` · 404 `not_found` · 409 `already_decided` or apply failure |
| POST | `/api/admin/president/briefing` | — | `{ post, emailed }` |

All `/api/admin/president*` routes are owner-only.

## 6.3 Local AI

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/<local_ai>/status` | — | `{ enabled, available, president }` |
| POST | `/api/<local_ai>/chat` | `{ text, history?: [{ role: 'member' \| 'ore', text }] }` | `{ reply, reported: [{ id, title }] }` · 401 `sign_in` · 503 `ore_off` / `ore_unavailable` |

Optional header `x-<app>-platform: ios | android | web` is recorded on reported requests.

## 6.4 Environment

| Variable | Purpose |
|---|---|
| `<APP>_OWNER_EMAILS` | Comma-separated owner emails |
| `ANTHROPIC_PRESIDENT_API_KEY` | President, staff, boardroom |
| `ANTHROPIC_API_KEY` | Local AI and everything else |
| `OPENAI_API_KEY`, `XAI_API_KEY`, `MOONSHOT_API_KEY` | Other seats |
| `CARTESIA_API_KEY`, `ELEVENLABS_API_KEY` | Voice |
| `<APP>_DIRECTIVE_SECRET` | Signs directives and hashes member refs |
| `RESEND_API_KEY`, `RESEND_FROM` | Briefing and owner email |
| `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET` | Identity verification |
| `<APP>_ANTHROPIC_BASE` | Test stand-in base URL |
