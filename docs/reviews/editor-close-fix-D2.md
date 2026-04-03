# Review — `editor_close` handler fix — Phase D2

**Date:** 2026-04-02  
**Reviewer:** Reviewer agent  
**Files reviewed:**
- `packages/editor/src/tools/editor-handlers.ts` — `closeHandler` (lines 94–145)
- `packages/editor/src/__tests__/editor-handlers.test.ts` — CLOSE-02, CLOSE-04
- `packages/editor/src/__tests__/editor.test.ts` — §4.2-CLOSE-02, §4.2-CLOSE-04

---

## Summary of change

The `closeHandler` was changed to add a 3-step fallback strategy:

1. **No path** → call `workbench.action.closeActiveEditor` directly (previously checked `activeTextEditor !== null` first, which blocked webview panels from closing)
2. **Path given, URI match found** → close tab via `tabGroups.close()`
3. **Path given, URI match not found → try label match** (strips path prefix + `.mmd` extension for webview panels)
4. **Path given, neither match found** → fall back to `workbench.action.closeActiveEditor` (previously returned `{ error: "File is not open: <path>" }`)

Two requirement-linked tests were updated to expect `{ closed: true }` instead of `{ error: ... }` in CLOSE-02 and CLOSE-04.

---

## Checklist

### 1. Tests: PASS

```
 ✓ src/__tests__/editor-handlers.test.ts (47 tests)
 ✓ src/__tests__/editor.test.ts (86 tests)
 Test Files  8 passed (8)
       Tests  347 passed (347)
```

Zero failures, zero skipped.

### 2. Type checker: PASS

`tsc --noEmit` exits clean with zero errors on `packages/editor`.

### 3. Linter: FAIL (pre-existing, not introduced by this change)

```
/data/projects/accordo/packages/editor/src/extension.ts
   99:76  error  Missing return type on function  @typescript-eslint/explicit-function-return-type
  104:23  error  Missing return type on function  @typescript-eslint/explicit-function-return-type
```

**Finding:** These 2 errors are in `extension.ts`, introduced by the command-registration refactor that is in the same working-tree batch but is a **separate concern** from the `closeHandler` fix. The `closeHandler` diff itself (`editor-handlers.ts`) is linter-clean — `eslint src/tools/editor-handlers.ts` produces zero findings. The `eslint.config.mjs` itself is also new (the committed HEAD used `echo 'no lint configured yet'`), so these errors were latent before this session.

**Severity:** Medium — must be fixed before this commit reaches Phase E, but is not a regression caused by the close-handler logic.

**Fix required (in `extension.ts`):**
```typescript
// Line 99 — add return type to arrow
const cmd = (id: string, fn: (args: Record<string, unknown>) => unknown): vscode.Disposable =>
  vscode.commands.registerCommand(id, (args: unknown) =>
    fn((args as Record<string, unknown> | undefined) ?? {}),
  );

// Line 104 — add return type to arrow
const getState = (): IDEState => bridge.getState();
```

### 4. Coding guidelines compliance: CONDITIONAL PASS

| Rule | Status | Notes |
|---|---|---|
| No `any` | ✅ PASS | Zero occurrences in changed files |
| No non-null assertions without comment | ✅ PASS | None added |
| `as X` casts require type guard justification | ⚠️ NOTE | `tab.input as { uri?: vscode.Uri }` — pre-existing cast, not introduced by this change |
| No commented-out code | ✅ PASS | Removed comment counts as an improvement |
| No `console.log` in production | ✅ PASS | None |
| No TODO/FIXME without tracking | ✅ PASS | None |
| Functions ≤ ~40 lines | ✅ PASS | `closeHandler` is 49 lines total, ~36 lines of implementation code |
| File ≤ ~200 lines implementation | ✅ PASS | `editor-handlers.ts` is 242 lines total, 205 non-blank/non-comment |
| Explicit return types on exported functions | ✅ PASS | `closeHandler` return type is explicit |

**Pre-existing cast note:** `tab.input as { uri?: vscode.Uri }` at line 111 is an unsafe `as X` cast — the VSCode Tab API does not expose a common typed `.uri` field on all `TabInput` variants. This was present before this fix and is a known VSCode API limitation. A justifying comment was previously present on this line (removed in the diff), but the inline comment on the surrounding block adequately explains the pattern. **No action required**, but the justifying comment should be restored or the surrounding block comment updated to reference the cast reason.

### 5. Correctness of the 3-step fallback logic: CONDITIONAL PASS

The logic is sound for the stated goals. However, **one correctness concern exists** at step 4:

#### FAIL — High severity: Misleading success response when path was given but not found

**Location:** `packages/editor/src/tools/editor-handlers.ts` lines 133–138

**Problem:** When the caller passes `path="C.md"` (an explicit intent to close a specific file), and `C.md` is not open in any tab, the handler silently closes **whatever is currently active** and returns `{ closed: true }`. This is a semantic contract violation:

- The caller asked to close `C.md`.
- The tool confirmed it closed `C.md` (by returning `{ closed: true }`).
- In reality it closed `B.ts` (or nothing, if no editor is focused).

This is not the same as the `no-path` case where the caller's intent is "close active". With a path argument, the caller has a specific target. Silently closing the wrong tab is worse than returning a recoverable error — the caller has no signal that anything went wrong.

**Counter-argument acknowledged:** The fix was motivated by the fact that webview panels (`.mmd` diagram panels) appear in `tabGroups.all` but do NOT expose their path through either the URI field or consistently through the label, making it impossible to reliably identify them by URI. This is a real VS Code API limitation.

**Recommended fix (two options):**

*Option A — Narrow the fallback to known webview extensions only:*
```typescript
if (!foundTab) {
  // Only fall back for known webview-type paths (.mmd) where the Tab API
  // does not expose URI. For all other paths, return a recoverable error.
  if (resolved.endsWith(".mmd")) {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    return { closed: true };
  }
  return { error: `File is not open: ${resolved}` };
}
```

*Option B — Keep the fallback but include a `fallback: true` field in the response* so callers can detect the ambiguity:
```typescript
await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
return { closed: true, fallback: true };
```
Note: Option B requires a return-type update: `{ closed: true; fallback?: true } | { error: string }`.

Option A is preferred because it preserves the original error contract for text files while extending graceful behavior only to the known-problematic webview case.

### 6. Test coverage adequacy: PARTIAL PASS

| Requirement from §4.2 | Test exists | Notes |
|---|---|---|
| No path given — closes active editor | ✅ CLOSE-01, §4.2-CLOSE-01 | Correct |
| No path, no active editor → success | ✅ CLOSE-02 (updated) | Updated test matches new behavior |
| Path given, tab found by URI → close it | ✅ CLOSE-03, §4.2-CLOSE-03 | Correct |
| Path not found → fallback closes active | ✅ CLOSE-04 (updated) | Tests the new behavior |
| **Path given, label match succeeds (webview case)** | ❌ **MISSING** | No test covers the new label-matching path (lines 119–132) |
| **`closeActiveEditor` command rejection** | ✅ §4.2-CLOSE-R01 | Covers the no-path command branch |
| **`closeActiveEditor` rejection in fallback** | ❌ **MISSING** | The fallback at line 137 has no rejection test |

**Missing tests (should be added):**

1. **CLOSE-LABEL-01:** Path given, no URI match, but `tab.label` matches the stripped filename → returns `{ closed: true }` and calls `tabGroups.close` (not `closeActiveEditor`).
2. **CLOSE-FALLBACK-REJECT-01:** Path given, no tab found → fallback calls `closeActiveEditor`, which rejects → handler returns `{ error: string }`.

These gaps do not block the fix from shipping but should be addressed. Severity: Low.

### 7. Requirements drift: FAIL (spec not updated)

**Location:** `docs/20-requirements/requirements-editor.md` §4.2

The requirements spec still lists:

```
| No active editor and no path given | "No active editor to close" |
| File not open                       | "File is not open: <path>"  |
```

Both error conditions were intentionally removed by this fix. The spec is now stale. This is not a code problem but a documentation consistency failure.

**Fix required:** Update §4.2 error table in `requirements-editor.md` to reflect the new behavior:

| Condition | Behavior |
|---|---|
| No path given | Closes active editor tab (text or webview); always returns `{ closed: true }` |
| Path given, tab found by URI | Closes that tab; returns `{ closed: true }` |
| Path given, tab found by label (webview) | Closes that tab; returns `{ closed: true }` |
| Path given, tab not found | Falls back to closing active editor; returns `{ closed: true }` |

Severity: Medium.

### 8. Architectural constraints: PASS

- No VSCode imports in Hub packages — N/A (change is in `accordo-editor`)
- Security middleware — N/A (no HTTP endpoints changed)
- Handler functions not serialized — not affected

### 9. Runtime discoverability: PASS (with note)

The tool is already registered under `accordo_editor_close` in both the MCP tool list (via `editorTools[]`) and as a VSCode command (via the `cmd(...)` registration in `extension.ts`). No registration changes were made.

---

## Summary verdict

### PASS items

- Tests: 347 passing, zero failures
- TypeScript: clean, zero errors
- Logic for the webview use case: correct
- No new banned patterns
- Architectural constraints: respected

### FAIL — must fix before Phase E

| ID | File | Line | Issue | Fix |
|---|---|---|---|---|
| F1 | `src/extension.ts` | 99, 104 | Lint: missing return types on two arrow functions (introduced in same working-tree batch, not part of close-fix diff but blocks lint clean) | Add `: vscode.Disposable` and `: IDEState` return type annotations |
| F2 | `src/tools/editor-handlers.ts` | 133–138 | High: fallback silently closes wrong tab when caller explicitly requested a specific path that isn't open — `C.md` not open → closes `B.ts` with `{ closed: true }` | Narrow fallback to `.mmd` extension only (Option A), or retain fallback but restore the error for non-webview paths |
| F3 | `docs/20-requirements/requirements-editor.md` | §4.2 | Requirements spec still documents the old error conditions that were removed — spec is now inconsistent with implementation and tests | Update §4.2 error table to match new behavior |

### Advisory (not blocking)

| ID | File | Issue |
|---|---|---|
| A1 | `editor-handlers.ts:111` | Unsafe `as { uri?: vscode.Uri }` cast is pre-existing but its justifying comment was deleted in the diff — restore a one-liner explaining the VS Code `TabInput` discriminated union limitation |
| A2 | `editor-handlers.test.ts` | No test for the label-match branch (lines 119–132) — the fix's primary new code path is untested |
| A3 | `editor-handlers.test.ts` | No rejection test for the `closeActiveEditor` call in the fallback branch (line 137) |

---

## Rename question: `accordo_editor_close` → `accordo_window_close`?

**Recommendation: Do not rename.**

Rationale:
1. The tool still closes editor *tabs* — which is an editor-layer concept. `window_close` implies closing the window/application in most environments.
2. The fallback behavior (closing webviews) is a best-effort implementation detail, not a semantic contract change. The tool's intent remains "close an editor tab or active editor".
3. Renaming is a breaking change to all existing agent scripts, MCP tool call history, and the NarrationScript command catalog — the cost outweighs the naming precision gain.
4. If a rename were warranted, `accordo_editor_closeTab` would be more precise than `window_close`.

If the team wants to signal that the tool handles both text and webview tabs, update the tool **description string** in the tool definition rather than renaming the tool identifier.
