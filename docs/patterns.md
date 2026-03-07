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
  P-09: "Ollama model name is nomic-embed-text (not nomic-embed-text-v1.5) — v1.5 is the default tag"
  P-10: "mypy cache writes to project root — always pass --cache-dir /tmp/... when .mypy_cache is owned by another user"
  P-11: "git commit -m with embedded newlines hangs zsh — use single-line -m; put detail in commit body file if needed"
  P-12: "VS Code built-in Comments panel has no extensible context menu — view/item/context does not work; need custom TreeView panel"
  P-13: "Restarting Extension Host does NOT restart the Hub process — must kill Hub PID first, then restart Extension Host"
  P-14: "Hub dist is per-file, not a bundle — grep dist/prompt-engine.js etc., never dist/index.js"
  P-15: "Integration tests with fixed content strings fail on second run — dedup prevents new insert; fix with sync cleanup fixture before each test"
  P-16: "Async cleanup fixtures in pytest-asyncio cause asyncpg pool-loop mismatch — use sync psycopg2 for pre-test DB cleanup instead of async SQLAlchemy"
  P-17: "Neon.tech asyncpg DSN → psycopg2 DSN: replace +asyncpg driver AND ssl=require → sslmode=require"
  P-18: "LocalObjectStorage path traversal: always call resolved.relative_to(root_resolved) + raise from None (ruff B904)"
  P-19: "Chunker fallback overlap check: word-split is unreliable in char-splitting mode — verify overlap with char offsets instead"
  P-20: "Excluded-path leak check: string `in e.path` matches substrings (.git matches .gitignore) — use Path(e.path).parts set intersection"
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

### P-09 — Ollama model name is `nomic-embed-text`, not `nomic-embed-text-v1.5`

**Symptom:** `ollama pull nomic-embed-text-v1.5` returns `Error: pull model manifest: file does not exist`.

**Root cause:** The Ollama registry uses `nomic-embed-text` as the model name; v1.5 is the
default `latest` tag, not a separate name. The architecture doc references "nomic-embed-text-v1.5"
as the model version conceptually, but the actual CLI/API name is `nomic-embed-text`.

**Rule:** Always use `nomic-embed-text` in API calls, `.env`, and code. Document the version
as "v1.5 (nomic-embed-text latest)" in comments/docs when clarity is needed.

---

### P-10 — mypy cache writes to project root fail in shared filesystem

**Symptom:** `mypy` exits with `PermissionError: [Errno 13] Permission denied: '.mypy_cache/missing_stubs'`
even though the source files are readable.

**Root cause:** The agent runs as a different OS user than the one who initially ran mypy
(or created the `.mypy_cache/` dir). The directory is owned by the project owner, not `agentuser`.

**Workaround:** Always pass `--cache-dir /tmp/mypy_cache_construct` when calling mypy:
```bash
.venv/bin/mypy --cache-dir /tmp/mypy_cache_construct src/
```
Adding `cache_dir = "/tmp/mypy_cache_construct"` to `[tool.mypy]` in `pyproject.toml` does *not*
help because mypy writes `missing_stubs` to the *project root* cache dir before reading config.
The CLI flag is the reliable fix.

**Root cause to investigate:** Add a `make mypy` / `make lint` target in a `Makefile` or
`pyproject.toml` `[tool.taskfile]` that pre-sets the flag, so it doesn't have to be remembered.

---

### P-11 — `git commit -m` with embedded newlines hangs zsh

**Symptom:** Running `git commit -m "line1\n\nline2"` or a multi-line heredoc inside
`run_in_terminal` leaves the shell in `dquote>` / `cmdand dquote>` mode, waiting for a
closing quote that never comes. The terminal appears to complete (exit 0) but the
multi-line body is silently dropped or the shell hangs.

**Workaround A (preferred):** Use a single concise `-m` line with no embedding:
```bash
git commit -m "fix(module): short summary of changes"
```
Put detail in the commit body only when writing to a temp file with `create_file`
then passing with `-F`:
```
create_file → scripts/commit_msg.txt  (write body text)
run_in_terminal → git commit -F scripts/commit_msg.txt && rm scripts/commit_msg.txt
```

**Workaround B:** Write message via `printf` to a temp path **inside the home dir**, not `/tmp/`:
```bash
printf '%s' 'title\n\nbody' > ~/commit_msg.txt && git commit -F ~/commit_msg.txt
```
(Note: `/tmp/` writes from `agentuser` may also hit permission issues on macOS.)

---

### P-12 — VS Code built-in Comments panel has no extensible context menu

**Date:** 2026-03-05  
**Trigger:** Attempted to add Resolve / Reply / Delete to the right-click menu of the
built-in Comments panel (bottom bar → COMMENTS tab).

**Root cause:** The built-in Comments panel is a special VS Code view. It does **not**
honour `view/item/context` menu contributions — that contribution point only works for
extension-contributed `TreeView` instances. The only right-click action shown is VS Code's
own "Reply" (rendered when `widget.canReply` is truthy).

**What DOES NOT work from the built-in panel:**
- Custom context menu items (resolve, delete, reopen, reply, focus-in-preview)
- Overriding click-to-navigate (opens text editor via `editor.revealRange`, which doesn't
  work inside webview custom editors — no scroll, no popover)
- The built-in "Reply" action opens the inline editor widget in the text editor; it cannot
  target our webview popover

**What DOES work (alternative surfaces):**
- **Inline gutter widget** (text editor): `comments/commentThread/title` buttons for
  resolve, reopen, delete, focusInPreview; `comments/commentThread/context` input box for
  reply. These all work correctly.
- **Webview preview popover** (Comment SDK pins): full reply, resolve, reopen, delete via
  popover actions.

**Resolution:** Build a **custom Accordo Comments TreeView** sidebar panel (`vscode.window.createTreeView`) that we fully control. This will allow:
- Custom context menu via `view/item/context` (properly scoped to our view ID)
- Custom click handler that fires `focusInPreview` → webview scroll + popover
- Inline-edit reply in the tree
- Resolve / reopen / delete actions on every item

**Status:** Deferred — tracked as future feature (see workplan.md).

---

### P-13 — Restarting Extension Host does not restart the Hub process

**Symptom:** After rebuilding `accordo-hub`, doing "Restart Extension Host" in VS Code has no effect on the running prompt — the old code is still served.

**Root cause:** The Bridge (`hub-manager.ts`) checks port 3000 on startup. If a healthy Hub is already listening, it reconnects to it without spawning a new process. The Hub is a long-lived child process that survives Extension Host restarts.

**Correct procedure to pick up a new Hub build:**
1. Find the Hub PID: `ps aux | grep hub/dist | grep -v grep`
2. Kill it: `kill <PID>`
3. Restart Extension Host (`Cmd+Shift+P` → Restart Extension Host)

The Bridge will then find no healthy Hub on port 3000 and spawn a fresh one from `dist/index.js`.

**Note:** After killing the Hub, the Bridge's single auto-restart attempt (`restartAttempted` flag, LCM-10) is consumed. Step 3 is therefore required to get a clean spawn.

---

### P-14 — Hub dist is per-file, not a bundle — don't grep `dist/index.js`

**Symptom:** `grep "someSymbol" packages/hub/dist/index.js` returns no matches even though the symbol exists in source.

**Root cause:** `tsc -b` compiles each source file to its own `.js` file in `dist/`. There is no bundled `index.js` that contains all code — `dist/index.js` is only the entry-point shim that imports other modules.

**Workaround:** grep the specific compiled file:
- `dist/prompt-engine.js` for `renderPrompt` / system prompt logic
- `dist/server.js` for HTTP handler changes
- `dist/bridge-server.js` for WebSocket logic

Or search all dist files: `grep -r "symbol" packages/hub/dist/ --include="*.js" -l`

---

## Archive (resolved patterns)

*Entries moved here once the root cause has been addressed in tooling or process.*

---

### P-15 — Integration tests with fixed content strings fail on the second run

**Symptom:** An integration test that calls `IngestionService.ingest()` with a literal
content string (e.g. `"Retry test"`) passes on the first run but fails on all subsequent
runs because `after_count` stays at 0 — no new outbox row is created.

**Root cause:** The ingestion pipeline deduplicates by `(workspace_id, source_type, content_hash)`.
A previous run already committed the same content, so `ingest()` returns the existing row
without inserting — meaning the DB trigger never fires and no outbox row appears.

**Fix:** Add a synchronous cleanup fixture (see P-16) that deletes test-workspace rows before
each integration test, ensuring a clean slate every run.

**Location:** `tests/test_outbox.py` — `_clean_workspace` fixture + `@pytest.mark.usefixtures`.

---

### P-16 — Async cleanup fixtures cause asyncpg "Future attached to a different loop" errors

**Symptom:** When an `async def` fixture using `async_engine.begin()` is added as
`autouse=True`, previously-passing integration tests start failing with:
`RuntimeError: Task ... got Future ... attached to a different loop`

**Root cause:** With `asyncio_default_fixture_loop_scope = "session"` in `pyproject.toml`,
async fixtures run in the session-scoped event loop. The connections they establish get
pooled, tainted with the session loop's identity. When the test runs (in a function loop)
and tries to re-use a pooled connection, asyncpg detects the loop mismatch and raises.

**Fix:** Use a **synchronous** psycopg2 fixture for cleanup — it runs entirely outside the
event loop and leaves no asyncpg connections that can conflict (see P-17 for URL conversion).

```python
@pytest.fixture()
def _clean_workspace() -> Generator[None, None, None]:
    from tests.conftest import TEST_DATABASE_URL
    sync_dsn = (TEST_DATABASE_URL
        .replace("postgresql+asyncpg://", "postgresql://")
        .replace("ssl=require", "sslmode=require"))
    conn = psycopg2.connect(sync_dsn)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("DELETE FROM event_outbox")
        cur.execute("DELETE FROM engrams WHERE workspace_id = %s", (str(_WS_ID),))
    conn.close()
    yield
```

Decorate each integration test **class** (not function) with `@pytest.mark.usefixtures("_clean_workspace")`.

### P-17 — Neon.tech asyncpg DSN must be converted twice for psycopg2

**Symptom:** `psycopg2.connect(dsn)` raises `ProgrammingError: invalid URI query parameter: "ssl"`
when the DSN was derived from a Neon.tech asyncpg URL.

**Root cause:** The asyncpg URL uses `?ssl=require` but psycopg2 only understands `sslmode=`.
Additionally, the driver prefix `postgresql+asyncpg://` must be stripped to `postgresql://`.

**Fix:**
```python
sync_dsn = (TEST_DATABASE_URL
    .replace("postgresql+asyncpg://", "postgresql://")
    .replace("ssl=require", "sslmode=require"))
```

---

### P-18 — LocalObjectStorage path traversal guard

**Symptom:** When implementing a filesystem-backed `ObjectStorage`, keys containing `../`
or absolute paths escape the storage root silently.

**Root cause:** `Path(root) / key` does not sanitize `..` traversal components.
`(root / "../escaped.txt").resolve()` produces a path outside `root`.

**Fix:** Always resolve both sides and call `relative_to` before any file I/O:
```python
resolved = (self._root / key).resolve()
root_resolved = self._root.resolve()
try:
    resolved.relative_to(root_resolved)
except ValueError:
    raise ValueError(
        f"Storage key {key!r} escapes storage root {str(root_resolved)!r}"
    ) from None  # 'from None' required by ruff B904
```

**Context:** Discovered in WP6 security audit. Applies to any filesystem adapter.

---

### P-19 — Chunker overlap verification: use char offsets, not word lists

**Symptom:** Manual and automated overlap checks that compare `chunk[0].text.split()[-N:]`
against `chunk[1].text.split()[:N]` can fail spuriously when the chunker is in
char-splitting fallback mode.

**Root cause:** Char-based sliding windows slice mid-word at chunk boundaries.
The last word of chunk N may be partial, so it won’t match any complete word at
the start of chunk N+1 even when the chunks genuinely overlap.

**Fix:** Verify overlap using `Chunk.end_char` and `Chunk.start_char`:
```python
overlap_chars = chunk0.end_char - chunk1.start_char
assert overlap_chars > 0  # reliable in both real-tokenizer and fallback mode
```

**Context:** Discovered during WP6 D3 testing guide validation in a fallback-mode environment.

---

### P-20 — Excluded-path substring check creates false positives

**Symptom:** Checking whether a file path contains a substring (e.g. `".git" in e.path`)
produces false positives: a file inside `.gitignore`’s parent dir matches because
`.gitignore` contains the substring `.git`.

**Root cause:** String substring matching doesn’t respect path segment boundaries.

**Fix:** Use `Path.parts` for accurate segment membership:
```python
EXCLUDED = {".git", ".venv", "__pycache__"}
is_excluded = bool(EXCLUDED & set(Path(entry.path).parts))
```

**Context:** Discovered during WP6 testing guide validation of MT-1 (scan directory leak check).

*Entries moved here once the root cause has been addressed in tooling or process.*

*(empty — nothing resolved yet)*
