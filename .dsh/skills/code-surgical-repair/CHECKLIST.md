# Code Surgical Repair — Per-Task Gate

Copy this into your working notes for **every** task. All boxes must be ticked
before the task is reported complete.

```
TASK: _______________________________________________

[ ] 0. PREP     Skill loaded; phase stated.
[ ] 1. REVIEW   Files read (not guessed); error captured VERBATIM.
                SYMPTOM: ____________________________________
                TRIGGER: ____________________________________
                LOCUS:   ____________________________________
                ROOT:    ____________________________________

[ ] 2. EXTRACT  Minimal lesion identified; anchored replacement; no
                comment-out / no swallow / no stub / no @ts-ignore /
                no disabled check; cut not widened beyond lesion.

[ ] 3. INFUSE   Replacement type-correct, contract-correct, dependency-
                correct; reuses existing tokens/types/helpers; no parallel
                mechanism; premium states present.

[ ] 4. VERIFY   Reproduction re-run → symptom GONE (evidence: ______).
                Build passes. Types pass. No collateral damage.
                Premium look/feel intact. Live build auto-updated.

[ ] 5. REPORT   Surgical log emitted.

FORBIDDEN (confirm none occurred):
[ ] No rollback of progress
[ ] No removal/dilution of premium look, feel, experience
[ ] No rebuild-from-scratch
[ ] No over-lay / no roll-over / no deleting working code
[ ] No scope creep beyond the defect
```
