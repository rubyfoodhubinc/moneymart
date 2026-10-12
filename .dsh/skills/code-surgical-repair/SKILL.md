# Code Surgical Repair

**Status:** PERMANENTLY LOADED — applies to every task in this workspace, without exception.
**Skill ID:** `code-surgical-repair`
**Owner instruction:** "load up my skill which is the surgical method all through... ensure it works and is used on every task I give you."

---

## 1. Doctrine

> Repair by **excision and precise infusion** — never by demolition, rollback, or layering.

Code is a living body. When part of it is broken, a surgeon does not amputate the
limb to fix the wound, and does not stitch a patch *over* the wound. The surgeon
**isolates the diseased tissue** (the error), **extracts it cleanly**, and
**infuses correctly matched, healthy code** into exactly that site. The rest of
the body is untouched and remains premium.

## 2. Absolute Prohibitions

These are hard stops. Violating any one of them is a failed task.

| # | Prohibited act | Why |
|---|---|---|
| P1 | **Rolling back progress** | Deletes value already earned. Never silently revert a working feature to fix a broken one. |
| P2 | **Removing or diluting the premium look, feel, or experience** | The product's perceived quality is a first-class requirement, not decoration. |
| P3 | **Rebuilding from scratch** as a response to a bug | A bug is a local lesion, not a reason for a new body. |
| P4 | **Laying over** — stacking a patch, shim, or second implementation on top of existing code | Produces two sources of truth, drift, and hidden regressions. |
| P5 | **Rolling over** — leaving the broken code in place and routing around it | The defect remains live and will resurface. |
| P6 | **Deleting working code** to make an error disappear | Suppression is not a cure. |
| P7 | **Widening scope** beyond the reported defect | Unrequested refactors destroy stability and reviewability. |

## 3. The Surgical Method — 6 Phases

Every task, every time. No phase may be skipped.

### Phase 0 — PREP: Load the skill
Confirm this skill is loaded before touching a single file. State which phase you
are in when reporting.

### Phase 1 — REVIEW: Look at the code and see what was actually broken
- Read the real files. Never guess at contents.
- Reproduce the failure and capture the **verbatim** error: message, stack, file,
  line, and the exact input that triggered it.
- Locate the **lesion** — the smallest span of code responsible.
- Record: `SYMPTOM`, `TRIGGER`, `LOCUS (file:line)`, `ROOT CAUSE`.
- If no defect exists, say so plainly. Do not invent surgery on healthy tissue.

### Phase 2 — EXTRACT: Cut the error out cleanly
- Identify the **minimal contiguous region** containing the defect.
- Use surgical precision: anchored, targeted replacements (exact old string →
  exact new string). One logical change per cut.
- Remove the cause, not the symptom. Never comment-out, never `try/catch`-swallow,
  never `@ts-ignore`, never stub, never disable a check to silence an error.
- Never widen the cut beyond the lesion. Neighbouring healthy code is left intact.

### Phase 3 — INFUSE: Graft correctly matched, clean code
- The replacement must be **type-correct, dependency-correct, and
  contract-correct** with the surrounding code — same interfaces, same naming,
  same currency/units, same error semantics.
- Reuse the existing design system, tokens, types, and helpers. Do not introduce a
  parallel mechanism where one already exists.
- The graft must be **premium**: full-fidelity visuals, real states
  (loading / empty / error / success), accessible contrast, no placeholder cruft.
- Prefer the smallest correct implementation. Elegance is a correctness property.

### Phase 4 — VERIFY: Prove the graft took
- Re-run the exact reproduction from Phase 1. The symptom must be **gone**.
- Confirm no collateral damage: build passes, types pass, tests pass, the
  previously working feature still works.
- **Show the evidence.** Command output, not assurances.
- Verify that the premium look/feel is intact after the change.
- Confirm the running build reflected the change automatically (see §5).

### Phase 5 — REPORT: Surgical log
Emit a compact record:
```
LESION      file:line — one-line description
ROOT CAUSE  why it broke (mechanism, not blame)
EXCISED     what was removed (verbatim, minimal)
INFUSED     what replaced it (why this is correct)
VERIFIED    exact command + observed result
INTACT      progress preserved / premium preserved / no over-lay
```

## 4. Error Extraction Protocol

To "extract the error and infuse the clean cut correct code", always capture the
error at full fidelity **before** editing:

1. **Console/terminal** — last 40 lines of the failing command, verbatim.
2. **Stack trace** — deepest application frame (skip node_modules frames).
3. **Build output** — file, line, column, error code.
4. **Runtime/UI** — the exact user action, expected vs. actual.
5. **Network** — method, URL, status, response body for API faults.

Never paraphrase an error. An approximated error produces an approximated cure.

## 5. Continuous Integration of Change — every build shows up and updates automatically

Mandatory, on every change:

- **Hot reload / HMR must be live.** Run long-lived dev servers as tracked
  background jobs. Do not claim a UI updated without a watcher running.
- **One source of truth per artifact.** A fix lands in the source file; every
  surface (mobile, web, TV) consuming that source updates from it. No duplicated
  copy-pasted constants across apps — import from the shared package.
- **Verify at the real URL/device.** After a change, confirm the running app
  reflects it. State the exact URL or command used.
- **Never start a competing server** to fake an update. Update the existing one.

## 6. Premium Preservation Standard

A fix that degrades the experience is a regression, even if the error is gone.

- Brand tokens are law: Primary Gold `#F5A623`, Deep Navy `#0D1B2A`,
  Electric Green `#00D4A1`, Pure White `#FFFFFF`, Charcoal `#1C1C1E`.
- Typography roles: Clash Display (display ≥18pt), Inter (UI/body),
  Space Grotesk (numerals/data only).
- Every interactive surface: real loading, empty, error, and success states.
- Motion is purposeful (confetti on win, pulse on LIVE), never decorative noise.
- Accessibility: WCAG 2.1 AA contrast minimum.

## 7. Definition of Done (all must be true)

- [ ] Skill loaded and Phase 0–5 followed in order.
- [ ] Error extracted verbatim; root cause named.
- [ ] Minimal lesion excised; nothing healthy removed.
- [ ] Correct code infused at the exact site; contract-matched.
- [ ] Reproduction re-run; symptom gone; **evidence shown**.
- [ ] No rollback, no over-lay, no roll-over, no scope creep.
- [ ] Premium look, feel, and experience preserved or improved.
- [ ] Running build reflected the change automatically.
- [ ] Surgical log emitted.

---

*"Extract the error. Infuse the clean cut. Preserve the body."*
