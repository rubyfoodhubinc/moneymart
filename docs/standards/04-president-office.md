# 4. The President's office

Reference: `services/api/src/ai/president.ts`.

## 4.1 Data

| Collection | Shape |
|---|---|
| Staff | `{ id, name, title, department, seat, role, brain: string[], active, sort }` — seeded once with five heads |
| Posts (workspace) | `{ id, staffId \| null, kind, title, body, status, meta, createdAt, decidedAt?, decidedBy?, result? }` |
| Chat | `{ id, thread, role: 'owner' \| 'president', text, at }` |
| President's notes | setting `president.brain` (last 60) |
| Directives | setting `<local_ai>.directives`: `{ text, at, sig }` |

Post kinds: `report`, `request`, `alert`, `draft_change`, `draft_directive`, `draft_member_message`, `draft_post`, `draft_ad`.
Post status: `info` (reports, requests), `pending` (drafts), `approved`, `denied`, `done`, `failed`.

## 4.2 Context she sees each turn

1. **Business numbers** from the app's own store (last 7 days vs the 7 before): orders, sales, fees, disputes, members, new members, partners, live activity, AI cost.
2. **Staff list** with ids.
3. **Recent workspace**, newest first, wrapped in `<workspace>` and labelled data.

The system prompt holds: who she is, her notes, the charter (1.5), and the rule that public, paid or system changes are drafts.

## 4.3 Tools

| Tool | Does |
|---|---|
| `ask_staff(staff_id, task)` | The head writes one item (JSON: kind, title, body, optional note). Non-report kinds become pending drafts. |
| `remember(note)` | Adds to her notes |
| `business_report(days)` | Numbers for N days vs the N before |
| `member_requests()` | Requests from the local AI, wrapped as data, with how many members asked |
| `setting_list(q?)` | Settings with current values |
| `propose_setting_change(changes, why)` | Checked with `byPresident = true`; filed as a draft or refused with the reason |
| `propose_directive(directive, why)` | Draft for every local AI |
| `propose_member_message(subject, body, audience, why)` | Draft message; audience is an app-defined segment |
| `file_report(folder, title, body)` | Reports › daily / weekly / live |

Apps MAY add tools; any tool that acts outside the office MUST file a draft instead of acting.

## 4.4 The loop

- Up to **6** model steps per turn, up to **5** tool calls per step, up to **6** staff tasks per turn.
- Tool results are capped (12k characters). Tool errors return as `is_error` results, never crash the turn.
- History: last 16 lines of the thread, merged so roles alternate.
- If the President key is missing, she says so plainly and shows nothing else.

## 4.5 Deciding (approve / deny)

1. Load the post. Missing → `not_found`. Not pending → `already_decided`.
2. **Deny:** status `denied`, audit, done.
3. **Approve:** claim it first (status `approved`), then carry it out:
   - `draft_change` with settings → re-check (`byPresident = true`) and apply.
   - `draft_directive` → sign with HMAC-SHA256 over `at + "\n" + text` using a server secret; append.
   - `draft_member_message` → deliver to the audience's inboxes (and push/email where wired).
   - anything else → approved, carried out by hand (until a connector exists).
4. Success → status `done` with a `result` line, audit.
5. Failure → back to `pending` with `result: "Could not apply: …"`, audit `president_apply_failed`.

Unsigned or tampered directives are ignored when the local AI's prompt is built.

## 4.6 Daily briefing

- A timer checks every 15 minutes; once a day at `president.brief_hour_utc` it writes a briefing.
- With AI: her summary (how the day went vs the day before, decisions waiting, risks, top 3 recommendations, under 250 words) followed by the raw numbers.
- Without AI: the numbers and the list of decisions waiting. **A briefing always goes out.**
- Filed in Reports › daily and emailed to the owners. The Owner can also ask for one at any time.

## 4.7 Coming in later versions

Boardroom (round table chaired by the President, each seat its own model and voice, minutes become reports, "approve item 2"), private one-to-one rooms, voice calls, the 60-second watch (errors, latency, sign-in attacks, provider health → alerts), code changes as pull requests.
