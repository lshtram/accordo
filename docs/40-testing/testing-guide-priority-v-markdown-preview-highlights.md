# Testing Guide — Priority V: Markdown Preview Highlights

> **Module:** `packages/capabilities`, `packages/editor`, `packages/md-viewer`
> **What it verifies:** `accordo_editor_highlight` can apply and clear transient highlights in an already-open Accordo Markdown Preview without adding a new public MCP tool.

---

## Section 1 — Automated Tests

The following commands were executed and are currently passing.

### 1) Editor test suite

```bash
cd packages/editor
pnpm test
```

**What it verifies:**
- Text-editor highlight behavior remains unchanged.
- `.md` preview-only highlight requests route through `PREVIEW_APPLY_HIGHLIGHT`.
- Visible `.md` text editors stay authoritative and do not route to preview.
- Preview clear by `decorationId`, preview clear-all, and mixed text+preview clear-all use stored clear strategies.

**Current result:** 38 test files, 428 tests passing.

### 2) Editor typecheck, lint, and build

```bash
cd packages/editor
pnpm typecheck && pnpm lint && pnpm build
```

**What it verifies:**
- Shared capability imports compile correctly in the editor package.
- ESLint remains clean for touched editor code/tests.
- Extension dist output builds successfully.

### 3) Markdown viewer test suite

```bash
cd packages/md-viewer
pnpm test
```

**What it verifies:**
- Internal preview highlight commands are registered and delegated.
- Source line ranges map to unique rendered block IDs.
- Active highlights replay after each fresh webview ready signal and markdown rerender.
- Clear by ID preserves overlapping highlights and surviving colors.
- Clear-all removes preview highlight state and prevents replay.
- The production webview script applies and clears highlight DOM state through message handlers.

**Current result:** 10 test files, 145 tests passing.

### 4) Markdown viewer typecheck, lint, and build

```bash
cd packages/md-viewer
pnpm typecheck && pnpm lint && pnpm build
```

**What it verifies:**
- Highlight host/webview changes compile.
- Package build copies required webview assets after TypeScript build.
- Lint command remains clean. This package currently has a no-op lint script.

### 5) Capabilities contract tests

```bash
cd packages/capabilities
pnpm test && pnpm typecheck && pnpm build
```

**What it verifies:**
- `CAPABILITY_COMMANDS` includes the two canonical preview highlight commands.
- `PreviewCapability` and `CapabilityCommandMap` include object-shaped apply/clear highlight signatures.
- The shared package remains runtime-free and builds cleanly.

**Current result:** 3 test files, 89 tests passing.

---

## Section 2 — Manual Runtime Tests

Run these in a VS Code extension-development session after rebuilding `packages/capabilities`, `packages/editor`, and `packages/md-viewer`.

### Scenario 1 — Apply a preview highlight

1. Open a markdown file with `accordo_editor_open`, or open it with the Accordo Markdown Preview custom editor.
2. Call `accordo_editor_highlight` with the markdown file path and a small line range.
3. Inspect the preview.

**Expected result:**
- The rendered markdown block(s) corresponding to the source line range are highlighted.
- The tool returns `{ highlighted: true, decorationId: "..." }`.
- The markdown preview was not auto-opened by the highlight call itself.

### Scenario 2 — Clear one preview highlight

1. Apply two overlapping preview highlights with different colors.
2. Call `accordo_editor_clearHighlights` with the second returned `decorationId`.

**Expected result:**
- Only that highlight is cleared.
- The overlapping block remains highlighted with the surviving highlight color.

### Scenario 3 — Clear mixed text and preview highlights

1. Apply a highlight in a visible text editor.
2. Apply a highlight in an already-open markdown preview.
3. Call `accordo_editor_clearHighlights` without `decorationId`.

**Expected result:**
- Both text-editor and markdown-preview highlights are removed.
- The command returns a count covering both stored highlight entries.

### Scenario 4 — Rerender replay

1. Apply a highlight in an already-open markdown preview.
2. Edit and save the markdown file so the preview rerenders.

**Expected result:**
- The highlight is replayed after the refreshed webview reports ready.
- Clearing all highlights prevents the highlight from returning after a later rerender.

---

## Notes

- Review gate: Phase D2 reviewer returned PASS after remediation.
- Preview highlights are block-granular; character-level preview highlighting is intentionally out of scope.
- If no live Accordo Markdown Preview exists for a markdown file, `accordo_editor_highlight` preserves the existing `File is not open: <path>. Open it first.` behavior.
- To clear all highlights, omit `decorationId` entirely. Passing `decorationId: ""` is treated as a request for a specific empty ID and returns `Decoration not found: `.
- If a `.md` file is visible as a text editor, highlights intentionally use VS Code text-editor decorations; close or switch away from the text editor to exercise the preview route.
