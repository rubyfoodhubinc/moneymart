# AI Company Standard (v1.3)

A reusable standard for running an app with an **AI President**, an **Owner console**, and a **local AI on every member's device**. Any of our apps can adopt it, and any app can be updated against it.

MoneyMart is the reference implementation (`services/api/src/ai/`). The standard merges what the earlier Presidents proved:

| Source | What it gave the standard |
|---|---|
| President Eteka (Every Media AI) | Base: office of department heads, tool loop, drafts and decide, settings registry with locked keys, signed directives, access ranks |
| President Ruby (RubyNav) | Daily budgets that fail closed, risk flags, a briefing that still goes out without AI |
| President Ava (Kinroom) | Atomic approvals, admin audit log, watch and integrations, voice fallback |
| President Ada (NetPulsy) | Typed memory with dedupe, guards against injected instructions, token budget |

## The documents

| # | Document | Covers |
|---|---|---|
| 1 | [Roles and authority](01-roles-and-authority.md) | Who is who, what the AI may do alone, what needs the Owner |
| 2 | [AI gateway](02-ai-gateway.md) | One caller for every model provider, keys, fallback, budgets, cost |
| 3 | [Owner console](03-owner-console.md) | Access ranks, tabs, the settings registry, audit |
| 4 | [The President's office](04-president-office.md) | Staff, the tool loop, drafts, approvals, briefings |
| 5 | [Local AI](05-local-ai.md) | The member's assistant, reporting up, directives down, privacy |
| 6 | [API contract](06-api-contract.md) | Routes, request and response shapes |
| 7 | [Conformance tests](07-conformance.md) | The checks an implementation must pass |
| 8 | [Verification and notifications](08-verification-and-notifications.md) | Identity checks, one delivery path, iPhone push, Owner messages |
| — | [Adoption checklist](ADOPTING.md) | Step by step for a new or existing app |
| — | [Changelog](CHANGELOG.md) | Versions of this standard |

## Words used

- **MUST** / **MUST NOT**: required to conform.
- **SHOULD**: expected unless the app has a written reason.
- **MAY**: optional.
- **Owner**: the human who owns the app. Final say.
- **President**: the Owner's AI chief executive. One per app. Configurable name (MoneyMart: "Ore").
- **Local AI**: the assistant inside the app for each member. Configurable name (MoneyMart: "Ore").
- **Draft**: anything the AI wants done that is public, paid or changes a system. It waits for the Owner.

## Naming per app

Each app picks its own names and keeps the structure:

| App | President | Local AI |
|---|---|---|
| MoneyMart | President Ore | Ore |
| (your app) | President _name_ | _name_ |

The President's name is a console setting (`president.name`), not code.

## Versioning

The standard uses `MAJOR.MINOR`. A MINOR version adds things an app may adopt later. A MAJOR version changes a MUST. Each app records the version it conforms to in its own `docs/ai-company-spec.md`.
