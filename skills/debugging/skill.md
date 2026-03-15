---
id: debugging
version: 1.0.0
tags: [debugging, root-cause, logging, instrumentation]
knowledge:
  - knowledge/systematic-process.md
  - knowledge/instrumentation-guide.md
---

# Skill: Systematic Debugging

## When to Use

Load `knowledge/systematic-process.md` when:
- A test fails and the cause is not immediately obvious
- Runtime behaviour differs from what the code implies
- You need to add instrumentation before you can understand what's happening

Load `knowledge/instrumentation-guide.md` when:
- You need to decide *where* to add logging and *what* to log
- You are adding a temporary debug path that must be cleaned up before commit

---

## The Five-Phase Rule

Never skip phases. If stuck, go back one step.

```
Phase 1 -- OBSERVE        Collect exact symptoms. No hypotheses yet.
Phase 2 -- INSTRUMENT     Add targeted logging to expose hidden state.
Phase 3 -- HYPOTHESIZE    Form <=3 ranked hypotheses. One cause only.
Phase 4 -- VERIFY         Prove or disprove each hypothesis with evidence.
Phase 5 -- FIX & CONFIRM  Minimal fix. Re-run full test suite. Clean up logs.
```

---

## Banned Patterns

- Changing code without first reading the full error message
- Running tests repeatedly on unchanged code hoping they pass
- Commenting out assertions to make a test "pass"
- Retrying the exact same fix after it failed -- form a new hypothesis instead
- Fixing the symptom instead of the root cause

---

*Sources: `knowledge/sources.md`*
