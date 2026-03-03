---
patterns:
  P-01: "create_file cannot overwrite — use replace tools or write-script-then-run pattern"
  P-02: "run_in_terminal drops heredocs — never write scripts via heredoc, use create_file"
  P-03: "test output truncation — always pipe pnpm test through tail or grep"
  P-04: "replace_string_in_file fails when context mismatches — re-read file before editing"
  P-05: "run_in_terminal must be sequential — never parallelize terminal calls"
  P-06: "testing guide goes stale — candidate for gen script in D3 phase"
  P-07: "pre-push hooks may not be installed — candidate for prepare script auto-install"
  P-08: "semantic_search must not be parallelized — use search_subagent for multi-term search"
---

# patterns.md — Agent Working Patterns and Known Friction

> This file is maintained by the AI agent itself.
> When something doesn't work as expected, or a workaround is discovered, record it here.
> Reviewed periodically with the user to eliminate root causes and keep entries from going stale.
>
> **Quick scan:** Read only the YAML front matter above to know what is documented.
> Load the full file only if a relevant pattern ID applies to your current task.

---

## How to use this file

- **Before starting any task:** scan this file for patterns that apply.
- **After hitting an obstacle:** add an entry so future sessions don't repeat the mistake.
- **During reviews:** the user and agent go through entries together; resolved items move to the Archive section at the bottom.

---

## Active Patterns

---

### P-01 — `create_file` cannot overwrite existing files

**Symptom:** Calling `create_file` on a path that already exists returns an error.
You cannot use it to update or restructure an existing file.

**Workaround A — small edits:** Use `replace_string_in_file` (single location) or
`multi_replace_string_in_file` (multiple locations, same or different files, in one call).
Always include 3–5 lines of unchanged context before and after the target text.

**Workaround B — large structural rewrites** (e.g. reordering sections):
1. `create_file` to a *new* path inside `scripts/` (never `/tmp/`) — write Python or Node script.
2. `run_in_terminal` to execute the script.
3. `run_in_terminal` to `rm` the script.

**Example:**
```
create_file → scripts/restructure_guide.py
run_in_terminal → python3 scripts/restructure_guide.py && rm scripts/restructure_guide.py
```

**Root cause to investigate:** Can we expose a `write_file` (overwrite-safe) tool in the MCP
server or route through the Bridge so the agent has a direct write primitive?

---

### P-02 — `run_in_terminal` rewrites or drops complex shell constructs

**Symptom:** Multi-line heredoc strings passed to `run_in_terminal` are silently rewritten
by the tool middleware; the heredoc body is often lost. A script written to `/tmp/` in one
`run_in_terminal` call does not persist for a second call because the tool may spawn a fresh
shell context or rewrite the path.

**Rule:** Never write a script via heredoc in `run_in_terminal` and then execute it in a
second call. Write the script with `create_file` (P-01 Workaround B above) instead.

**Safe patterns:**
- Single self-contained shell one-liners: ✅
- Pipelines with `|`, `&&`, `||`: ✅
- Python `-c '...'` one-liners (short): ✅
- Heredoc to create a file: ❌ — use `create_file`
- Two-step "write to /tmp then execute": ❌ — use `create_file` + `run_in_terminal`

---

### P-03 — Terminal output truncation on large test runs

**Symptom:** `pnpm test` output exceeds the tool's result buffer and is cut mid-line.
You lose the pass/fail summary.

**Rule:** Always pipe test runs through a filter:
```
pnpm --filter <package> test 2>&1 | tail -12
pnpm --filter <package> test 2>&1 | grep -E "Tests|Test Files|FAIL"
```
Never run bare `pnpm test` expecting to read the full output in one call.

---

### P-04 — `replace_string_in_file` fails silently when context doesn't match exactly

**Symptom:** A replacement returns an error saying the string was not found, even though you
can see the text in the file. Usually caused by:
- Trailing whitespace differences
- Windows vs Unix line endings
- The target text appearing in a summarised/truncated file view (the real file differs)
- Insufficient context lines (only 1–2 lines, which matched multiple locations)

**Rule:**
1. Read the exact file section with `read_file` immediately before making an edit.
2. Include at least 3 lines of unchanged context before and after.
3. Do not copy text from a summarised output — always re-read from the file.

---

### P-05 — Parallel `run_in_terminal` calls cause race conditions

**Symptom:** Running two terminal commands in the same parallel batch produces interleaved
output or the second command reads stale state left by the first.

**Rule:** `run_in_terminal` must always be sequential — wait for output before issuing the
next command. All other read-only tools (`read_file`, `grep_search`, `file_search`,
`list_dir`) can be batched in parallel freely.

---

### P-06 — Testing guide maintenance is manual and error-prone

**Symptom:** Test counts, section coverage markers, and per-test status in the testing
guide get out of sync with the actual codebase each week. We spent significant time
updating the guide after every bug fix or new automated test.

**Improvement to consider:** Write a small script (`scripts/gen-test-coverage-table.ts`)
that parses e2e test names (all `it("§E2E-...` strings) and emits a Markdown table.
Run it as a step in the D3 phase of each TDD cycle, rather than updating the guide by hand.

---

### P-07 — No pre-push hook enforcing quality gates

**Symptom:** Commits with no-any violations or failing tests occasionally slip through
because `pnpm test` was not run in the right package before committing.

**Existing setup:** There is a `scripts/git-hooks/pre-push` file but it may not be
installed in every developer's clone.

**Improvement to consider:** Add `prepare` script to root `package.json` that installs
`scripts/git-hooks/pre-push` as `.git/hooks/pre-push` automatically on `pnpm install`.
Also add a pre-push check that runs `pnpm test` and `pnpm build` before any push.

---

### P-08 — `semantic_search` should not be parallelized

**Symptom:** Calling `semantic_search` in parallel with other `semantic_search` calls
produces degraded or duplicate results.

**Rule:** Use `search_subagent` for any complex multi-term codebase exploration.
Use a single `semantic_search` call only for simple, targeted lookups. Never batch two
`semantic_search` calls in the same parallel block.

---

## Archive (resolved patterns)

*Entries moved here once the root cause has been addressed in tooling or process.*

*(empty — nothing resolved yet)*
