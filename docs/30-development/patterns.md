---
patterns:
  P-01: "create_file cannot overwrite — use replace tools or write-script-then-run"
  P-02: "run_in_terminal drops heredocs — use create_file instead"
  P-03: "test output truncation — pipe through tail or grep"
  P-04: "replace_string_in_file context mismatch — re-read file before editing"
  P-08: "semantic_search must not be parallelized — use search_subagent"
  P-11: "git commit -m with newlines hangs zsh — single-line -m or use -F file"
---

# patterns.md — Generic Agent Patterns

> Patterns that apply to **any project** using AI agents with VS Code tooling.
> Project-specific patterns live in a separate `<project>-patterns.md` file.
>
> **Quick scan:** Read the YAML header above. Load full sections only when relevant.

---

## P-01 — `create_file` cannot overwrite existing files

`create_file` errors on existing paths.

- **Small edits:** `replace_string_in_file` or `multi_replace_string_in_file` with 3+ context lines.
- **Large rewrites:** `create_file` a script in `scripts/`, `run_in_terminal` to execute, then `rm` it.

---

## P-02 — `run_in_terminal` drops heredocs

Multi-line heredocs are silently rewritten or lost by the tool middleware.

- **Rule:** Never write scripts via heredoc. Use `create_file` + `run_in_terminal`.
- Single-line commands, pipelines (`|`, `&&`), and short `python -c` are safe.

---

## P-03 — Terminal output truncation on large test runs

Test output exceeds the tool's buffer and gets cut.

- **Rule:** Always pipe: `pnpm test 2>&1 | tail -12` or `grep -E "Tests|FAIL"`.

---

## P-04 — `replace_string_in_file` fails on context mismatch

Replacement not found due to whitespace, line-ending, or stale context.

- **Rule:** `read_file` immediately before editing. Include 3+ unchanged context lines.

---

## P-08 — `semantic_search` must not be parallelized

Parallel `semantic_search` calls produce degraded/duplicate results.

- **Rule:** Use `search_subagent` for multi-term exploration. Never batch two `semantic_search` calls.

---

## P-11 — `git commit -m` with newlines hangs zsh

Multi-line `-m` strings leave the shell in `dquote>` mode.

- **Rule:** Single concise `-m` line. For longer messages, `create_file` a message file + `git commit -F`.
