# Systematic Debugging Process

> **Rule:** Never skip a phase. If you are stuck, go back one step.
> **Rule:** Only one hypothesis is active at a time. Disprove it or fix it fully before moving on.

---

## Phase 1 — OBSERVE: Collect Exact Symptoms

Before touching any code, gather:

### 1.1 The error in full
- Read the complete error message, stack trace, or test failure output — do not skim.
- Record the **exact** text (copy-paste, not paraphrase).
- Note the **file : line** the error originates from (not where it was caught).

### 1.2 Reproduction path
- Can you reproduce it deterministically? If not, find the conditions that make it consistent.
- Minimum reproduction: smallest test or command sequence that triggers the bug.
- Note: does it break in tests only, at runtime only, or both?

### 1.3 Recent changes
- `git log --oneline -10` — what changed last?
- `git diff HEAD~1` — is the diff small enough to read? If so, read it.
- Did a dependency version change? (check the lock file diff)

### 1.4 Environment context
- Which component / process is involved?
- Is the server / background process running?
- Language runtime version if relevant.

### Checklist before moving to Phase 2
- [ ] I have the exact error message (full text, not summarised)
- [ ] I know which file + line is the origin
- [ ] I know whether this is a test failure, a runtime failure, or both
- [ ] I have checked recent commits

---

## Phase 2 — INSTRUMENT: Add Targeted Logging

**Goal:** Make invisible state visible. Add the minimum logging needed to answer
a specific question. Consult `knowledge/instrumentation-guide.md` for *how*.

### 2.1 Form a question first
Before adding any log, state the question:
> "I need to know the value of X at point Y in the code flow"

If you cannot state the question, go back to Phase 1.

### 2.2 Place logs at decision points
Log at:
- Entry/exit of the function where the error originates
- Each branch of a conditional that leads to the error path
- The point where data is transformed (before and after)
- The boundary between components / services

### 2.3 Log enough context
Bad: `console.error("failed")`
Good: `logger.error({ id, error: err.message, stack: err.stack }, "operation failed")`

Always log:
- An identifier (request ID, operation name, module)
- The inputs that caused the failure
- The full error object (not just `.message`)

### 2.4 Run the system and collect output
- Run tests in verbose mode and capture to a file for inspection
- Start background services manually with stdout captured (e.g. pipe to `tee /tmp/debug.log`)
- Check all available log channels for the component under investigation

### 2.5 Do not leave instrumentation in source indefinitely
Mark every temporary log with `// DEBUG:` comment so it is easy to find and remove.

---

## Phase 3 — HYPOTHESIZE: Form Ranked Hypotheses

**Rule:** Maximum 3 hypotheses. Ranked by probability. Only test one at a time.

### 3.1 Hypothesis format
```
H1 (most likely): <single sentence stating the specific cause>
H2: <alternative cause>
H3: <least likely cause>
```

### 3.2 Avoid these mistakes
- ❌ "Something is wrong with the network layer" — too vague, not testable
- ❌ "It could be the config, or the token, or the port" — multiple causes, pick one
- ✅ "Component A sends data before Component B completes its handshake, so B processes it with uninitialised state"

### 3.3 Root cause vs symptom
Ask "why?" at least 3 times:
```
Symptom:    Test fails with "item not found"
Why #1:     The item was never registered
Why #2:     Registration happened but was lost when service A restarted
Why #3:     Service B reused a stale connection from the previous session
Root cause: Connection lifecycle does not clear state on reconnect
```

Fix the root cause, not the 1st-level symptom.

---

## Phase 4 — VERIFY: Prove or Disprove Each Hypothesis

### 4.1 Design a targeted test
For each hypothesis, write the smallest possible test that would pass if the
hypothesis is true and fail if it is false. Do not write an exhaustive test yet —
you are probing, not shipping.

### 4.2 If the test disproves the hypothesis
- Move to H2. Do **not** tweak the original fix to "make it work anyway".
- Update your Phase 1 notes — new evidence may have appeared.

### 4.3 If the test confirms the hypothesis
- You have a root cause. Move to Phase 5.
- Ensure you can explain in one sentence *why* this causes the symptom.

### 4.4 When all 3 hypotheses are disproved
Go back to Phase 2 and add more instrumentation. Your current logging is
insufficient to reveal the real cause.

---

## Phase 5 — FIX & CONFIRM: Minimal Fix + Full Verification

### 5.1 Implement the minimal fix
- Change only what the root cause requires.
- Do not refactor, rename, or "improve" surrounding code in the same commit.
- If the fix requires touching multiple files, list them before starting.

### 5.2 Verify the fix
1. The specific failing test now passes
2. No regression in the affected package/module
3. No regression across the full test suite

### 5.3 Remove all temporary instrumentation
Search for `// DEBUG:` comments and remove them.
Verify no stray debug logging remains in source.

### 5.4 Validate the fix is complete
- [ ] Root cause (not just symptom) is fixed
- [ ] All tests pass
- [ ] Code compiles with no errors
- [ ] No temporary logging remains in source
- [ ] The fix is explainable in 1-2 sentences

### 5.5 Commit
```
fix(<scope>): <one sentence description of root cause fixed>
```

---

## Anti-Pattern Catalogue

| Anti-pattern | Why it fails | Correct approach |
|---|---|---|
| Commenting out the broken assertion | Hides the bug; it ships broken | Fix the root cause instead |
| Retrying the same fix | Wrong hypothesis — it won't work | Form H2 and test it |
| Logging `err.message` only | Stack trace is missing | Log the full error object |
| Fixing the symptom not the root cause | Bug recurs in different conditions | Ask "why?" 3 times |
| Stopping at the first "why?" | You found a symptom, not the cause | Keep asking until you hit an invariant |
