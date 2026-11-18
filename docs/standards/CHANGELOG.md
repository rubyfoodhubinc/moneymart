# Changelog

## 1.3 — 2026-11-17

- New §8: member identity checks through a hosted provider page (Didit), signed webhook plus refresh on return, an Owner switch for verified sellers only.
- One notification delivery path: inbox, live banner and iPhone push (APNs) with per-kind member switches; new automatic order alerts.
- Owner messages to audiences or one member, with preview, offer opt-outs and audit.
- Conformance: `verify-notify.mjs`, 57 checks (§7.12).

## 1.2 — 2026-11-17

- Local AI becomes the member's chief of staff: embedded platform guide, account snapshot as buyer and seller, read-only account and marketplace tools with in-app links (§5.1).
- Attachments: photos, PDFs and text files (§5.1, §6.3).
- Voice: `/speak` with Cartesia → ElevenLabs → phone voice; calls with listen → think → speak (§5.4, §5.6).
- App layout: greeting, composer with + / mic / send-or-call, recents drawer, chats stored per account on the device (§5.6).

## 1.1 — 2026-11-17

- Boardroom: round table chaired by the President, each head on its own model; private rooms; the Owner interjects; one round at a time; minutes to Reports; proposals filed as drafts (§4.7, §6.2a, §7.9).
- Local AI on iPhone: Ore opens from the Home header and Profile, only when `/status` says enabled and available; the conversation stays on the device (§5.6).
- Z.ai added as an OpenAI-compatible provider.

## 1.0 — 2026-11-17

First version, from the MoneyMart implementation (commit 2ee529a), merging Presidents Eteka, Ruby, Ava and Ada.

- Roles, authority and locked keys.
- AI gateway: Claude, OpenAI, xAI, Kimi; second key; one backup model; daily budgets that fail closed; cost metering.
- Owner console: ranks, tabs, owner-only tabs, settings registry, audit.
- President's office: five department heads, tool loop, drafts, atomic decide, signed directives, daily briefing.
- Local AI: member chat, anonymous merged requests up, directives down, on/off.
- Conformance: 34 checks.

Planned for 1.1: boardroom and private rooms, memory module (Ada), watch and integrations (Ava), voice calls, code changes as pull requests, Didit verification, notification rules.
