# /compound — Session Retrospective & Knowledge Capture

Triggered by: `compound` or `retrospective` at the end of any session.

---

## Constraint: do not trust context memory alone

Long sessions compact. The most valuable friction — failed tool calls, error
messages, retried approaches — is what gets summarised away first.

**Use git as ground truth. Use context only for recent turns.**

---

## Step 1 — Run these commands first, read all output

```bash
git log --oneline --since="12 hours ago"
git log --oneline -10 --stat
git diff --stat HEAD~5 HEAD
git status
pnpm test 2>&1 | tail -15
```

These five commands reconstruct what actually happened, regardless of how much
context was compacted.

---

## Step 2 — Self-reflect on the session

After reading the git output, answer these questions honestly:

1. **What files were edited more than once across separate commits?**
   → Each one is a candidate for a friction pattern entry.

2. **Did any `fix:` commit immediately follow another commit on the same file?**
   → The first approach failed. What was wrong with it?

3. **Are there test failures currently, or were there failing runs in the session?**
   → What was the root cause? Is it documented?

4. **Recall (or infer from git) any moment the user issued a correction or redirect.**
   → Was a directive in `AGENTS.md` missing or wrong?

5. **Did any new module boundary, protocol field, or type contract get established?**
   → Is it visible in `bridge-types` or `architecture.md`?

Be conservative. If you cannot confirm a finding from git evidence or recent
context (last ~30 turns), flag it as uncertain rather than writing it as fact.

---

## Step 3 — Write findings to the right file

### Friction & tool workarounds → `docs/patterns.md`

Only if: the same approach was tried twice, or there is an error in context, or
git shows a file touched in 3+ commits in the same session.

Append:
```markdown
### P-XX — [short title]

**Symptom:** [exact error or observable behaviour]
**Evidence:** [git commit hash, or "recent context"]
**Workaround:** [what actually worked]
**Root cause:** [why, and what would eliminate the workaround permanently]
```
Also update the YAML front matter summary line at the top of `docs/patterns.md`.

---

### Directive gaps → `AGENTS.md`

Only if: the user corrected the agent, or behaviour was demonstrably wrong due to
an ambiguous or missing rule.

- **High confidence** → apply the edit directly.
- **Uncertain** → append an HTML comment at the bottom of the relevant section:

```html
<!-- COMPOUND SUGGESTION: 2026-03-04
Section: [X.Y]
Issue: [what was ambiguous]
Evidence: [commit or context]
Proposed text: [exact addition]
Confidence: medium
-->
```

---

### New architectural facts → `docs/architecture.md`

Only if: a new type, protocol field, module boundary, or lifecycle behaviour was
established this session that is not yet documented.

Append an inline callout:
```markdown
> **Agent note [2026-03-04]:** [1–2 sentences. Cite the commit.]
```

---

## Step 4 — Output a one-page report

```
## /compound report — [date]

Sources used:
  git log: [N commits, list titles]
  context: [reliable / partially compacted / heavily compacted]

Patterns written: [N new to docs/patterns.md, list P-XX titles]
Directive gaps:   [N applied / N suggested as comments]
Architecture:     [N notes added / none]

Confidence:
  [Note any findings that relied on memory rather than git evidence.]
  [Note anything that felt uncertain and was skipped.]
```

---

## Quality bar — only write if at least one is true

- The same file appeared in multiple commits in this session
- An explicit error message exists in context (exact text, not paraphrase)
- The user issued a visible correction or redirect
- The test suite failed at some point during the session

**Skip:** first-attempt successes, obvious imports, single-call fixes.
