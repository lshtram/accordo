# Agent B3 Handoff — Voice, Diagram, Editor Leaf Splits

**Date:** 2026-03-29  
**Baseline commit:** `1651a03`  
**Packages:** `packages/voice`, `packages/diagram`, `packages/editor`  
**pnpm names:** `accordo-voice`, `accordo-diagram`, `accordo-editor`  
**Baseline tests:** voice=301, diagram=463, editor=182 (all green)

---

## 1. Your Mission

Split 3 oversized files across 3 independent packages. Each split is fully isolated — no cross-dependencies between them. All existing tests must remain green. No new cross-package dependencies.

**Do these in order: Voice → Diagram → Editor** (or in parallel within your session — they cannot conflict).

---

## 2. VOICE — `packages/voice/src/extension.ts` (806 LOC → split)

### 2.1 Files You OWN

| File | Action | Purpose |
|---|---|---|
| `src/extension.ts` | **MODIFY** — shrink to thin bootstrap | Keep `activate()`, `deactivate()`, `BridgeAPI` interface, `VoiceActivateDeps` interface |
| `src/voice-bootstrap.ts` | **CREATE** | VSCode activation ceremony: config reads, logger, status bar, commands, disposables |
| `src/voice-runtime.ts` | **CREATE** | Runtime selection logic (which STT/TTS provider to use), `SttProvider` construction, `reconcileSessionState`, session FSM wiring |
| `src/voice-adapters.ts` | **CREATE** | Adapter instantiation: kokoro subprocess, sherpa subprocess, faster-whisper HTTP, SoX recording |
| `src/__tests__/voice-bootstrap.test.ts` | **CREATE** | Tests for bootstrap |
| `src/__tests__/voice-runtime.test.ts` | **CREATE** | Tests for runtime selection |
| `src/__tests__/voice-adapters.test.ts` | **CREATE** | Tests for adapter instantiation |

### 2.2 Files You MUST NOT Touch (Voice)

| File | Reason |
|---|---|
| `src/__tests__/extension.test.ts` | Existing tests — must pass unchanged |
| `src/__tests__/*.test.ts` (all 20 existing) | All existing voice tests stay untouched |
| Any file in `src/ui/` | Voice UI panel — not part of this split |
| Any other existing `.ts` file in `packages/voice/src/` that is not `extension.ts` | Shared deps |

### 2.3 Exported Symbol Contract (Voice)

After refactor, `extension.ts` must still export:

```typescript
export interface BridgeAPI { ... }           // unchanged
export interface VoiceActivateDeps { ... }   // unchanged  
export async function activate(context, deps?): Promise<void>
export async function deactivate(): Promise<void>
```

No other files in the package import from `extension.ts` (confirmed — only `src/ui/voice-panel.ts` has a comment mentioning "extension" but no import).

### 2.4 Key Functions to Extract

- **To `voice-bootstrap.ts`**: Config reads (`vscode.workspace.getConfiguration("accordo.voice")`), `VoiceStatusBar` creation, command registration (`vscode.commands.registerCommand`), output channel, `loadPolicyFromConfiguration()`, `syncUiAndState()`, `updateStatusBar()`, `publishVoiceState()`
- **To `voice-runtime.ts`**: STT provider selection logic (the big `if/else` chain), `reconcileSessionState()`, session FSM wiring, `doStartDictation()`, `doStopDictation()`, `doToggleDictation()`, `insertDictationText()`  
- **To `voice-adapters.ts`**: `SherpaSubprocessAdapter` instantiation, `KokoroSubprocessAdapter` instantiation, `FasterWhisperHttp` instantiation, `buildReadyChimePcm()` helper

---

## 3. DIAGRAM — `packages/diagram/src/webview/panel.ts` (763 LOC → split)

### 3.1 Files You OWN

| File | Action | Purpose |
|---|---|---|
| `src/webview/panel.ts` | **MODIFY** — shrink `DiagramPanel` class | Keep class shell, constructor, `dispose()` |
| `src/webview/panel-core.ts` | **CREATE** | Core rendering methods + Mermaid parsing delegation |
| `src/webview/panel-commands.ts` | **CREATE** | VSCode command registration + webview message handling |
| `src/webview/panel-state.ts` | **CREATE** | Diagram state machine (loading, error, ready), export flow |
| `src/__tests__/panel-core.test.ts` | **CREATE** | Tests for core rendering |
| `src/__tests__/panel-commands.test.ts` | **CREATE** | Tests for command handling |
| `src/__tests__/panel-state.test.ts` | **CREATE** | Tests for state machine |

### 3.2 Files You MUST NOT Touch (Diagram)

| File | Reason |
|---|---|
| `src/extension.ts` | Only 72 LOC, already clean. Imports `DiagramPanel` from `./webview/panel.js` — that import MUST still work |
| `src/__tests__/panel.test.ts` | Existing tests — must pass unchanged |
| `src/__tests__/*.test.ts` (all 18 existing) | All existing diagram tests |
| `src/webview/html.ts` | Shared dependency |
| `src/webview/message-handler.ts` | Shared dependency |
| `src/webview/protocol.ts` | Shared dependency |
| `src/webview/scene-adapter.ts` | Shared dependency |
| `src/webview/webview.ts` | Shared dependency |
| Any file in `src/canvas/`, `src/comments/`, `src/layout/`, `src/parser/`, `src/reconciler/`, `src/tools/` | Other diagram modules |

### 3.3 Exported Symbol Contract (Diagram)

After refactor, `panel.ts` must still export:

```typescript
export class PanelDisposedError extends Error { ... }
export class ExportBusyError extends Error { ... }
export class PanelFileNotFoundError extends Error { ... }
export class DiagramPanel { ... }  // constructor, public methods unchanged
```

`src/extension.ts` does `import { DiagramPanel } from "./webview/panel.js"` — this MUST keep working.

### 3.4 Split Strategy (Diagram)

The `DiagramPanel` class is large. Two approaches:
- **Option A (recommended)**: Extract helper functions/classes into the new files and have `DiagramPanel` delegate to them. The class stays in `panel.ts` but shrinks because logic moves to helpers.
- **Option B**: Split the class using mixins or composition. More complex — only if Option A doesn't achieve the LOC target.

---

## 4. EDITOR — `packages/editor/src/tools/editor.ts` (594 LOC → split)

### 4.1 Files You OWN

| File | Action | Purpose |
|---|---|---|
| `src/tools/editor.ts` | **MODIFY** — shrink to barrel re-export | Keep `editorTools` array export, import from new files |
| `src/tools/editor-definitions.ts` | **CREATE** | JSON schema definitions for each editor tool |
| `src/tools/editor-handlers.ts` | **CREATE** | Handler implementations: `openHandler`, `closeHandler`, `scrollHandler`, `highlightHandler`, `clearHighlightsHandler`, `splitHandler`, `focusGroupHandler`, `revealHandler`, `saveHandler`, `saveAllHandler`, `formatHandler` |
| `src/__tests__/editor-definitions.test.ts` | **CREATE** | Tests for schema definitions |
| `src/__tests__/editor-handlers.test.ts` | **CREATE** | Tests for handlers |

### 4.2 Files You MUST NOT Touch (Editor)

| File | Reason |
|---|---|
| `src/extension.ts` | Imports `editorTools` from `./tools/editor.js` — that import MUST still work |
| `src/__tests__/editor.test.ts` | Existing tests — must pass unchanged |
| `src/__tests__/layout.test.ts` | Existing tests |
| `src/__tests__/terminal.test.ts` | Existing tests |
| `src/__tests__/util.test.ts` | Existing tests |
| `src/tools/layout.ts` | Separate tool file — not part of this split |
| `src/tools/terminal.ts` | Separate tool file — not part of this split |
| `src/util.ts` | Shared utility |

### 4.3 Exported Symbol Contract (Editor)

After refactor, `tools/editor.ts` must still export:

```typescript
export function _clearDecorationStore(): void   // test utility
export async function openHandler(args): Promise<...>
export async function closeHandler(args): Promise<...>
// ... all handler functions
export const editorTools: ExtensionToolDefinition[]
```

`src/extension.ts` does `import { editorTools } from "./tools/editor.js"` — this MUST keep working.

### 4.4 Split Strategy (Editor)

This is the simplest split — a clean definitions/handlers separation:
- **`editor-definitions.ts`**: The `editorTools` array with all JSON schemas (the big array of `{ name, description, inputSchema, handler }` objects). Export the schemas separately.
- **`editor-handlers.ts`**: All `*Handler` functions (`openHandler`, `closeHandler`, etc.) plus helper functions (`argString`, `argStringOpt`, `argNumber`, `argNumberOpt`), `decorationStore` map, `FOCUS_COMMANDS` constant.
- **`editor.ts`**: Imports handlers + definitions, assembles the `editorTools` array, re-exports everything.

---

## 5. Global Rules for ALL THREE SPLITS

### 5.1 Package Boundaries — NEVER CROSS

| Your packages | Forbidden packages |
|---|---|
| `packages/voice/` | `packages/hub/` (B1), `packages/bridge/` (B2), `packages/comments/` (B4), `packages/browser-extension/` (B5) |
| `packages/diagram/` | Same as above |
| `packages/editor/` | Same as above |

Also: `packages/bridge-types/` is **frozen** — do not modify.

### 5.2 `@accordo/bridge-types` barrel only

```typescript
import type { ExtensionToolDefinition } from "@accordo/bridge-types";  // ✅
import type { ExtensionToolDefinition } from "@accordo/bridge-types/tools";  // ❌ FORBIDDEN
```

### 5.3 Size targets

- Original file → <250 LOC after split
- No new file > 300 LOC

---

## 6. Verification Commands

```bash
# Voice
pnpm --filter accordo-voice test
pnpm --filter accordo-voice exec tsc --noEmit

# Diagram
pnpm --filter accordo-diagram test
pnpm --filter accordo-diagram exec tsc --noEmit

# Editor
pnpm --filter accordo-editor test
pnpm --filter accordo-editor exec tsc --noEmit

# LOC checks
wc -l packages/voice/src/extension.ts packages/voice/src/voice-*.ts
wc -l packages/diagram/src/webview/panel.ts packages/diagram/src/webview/panel-*.ts
wc -l packages/editor/src/tools/editor.ts packages/editor/src/tools/editor-*.ts
```

---

## 7. Commit Format

One commit per package split:

```
refactor(voice): decompose extension.ts into bootstrap/runtime/adapters modules
refactor(diagram): decompose panel.ts into core/commands/state modules
refactor(editor): decompose editor.ts into definitions/handlers modules
```

---

## 8. What NOT to Do

- ❌ Do NOT touch ANY files outside your 3 packages (`voice`, `diagram`, `editor`)
- ❌ Do NOT modify existing test files — only add new ones
- ❌ Do NOT change exported function/class/interface signatures
- ❌ Do NOT add new cross-package runtime dependencies
- ❌ Do NOT modify `bridge-types` package
- ❌ Do NOT change `extension.ts` files in `diagram` or `editor` (only `voice/src/extension.ts` and the `panel.ts`/`tools/editor.ts` targets)
- ❌ Do NOT introduce circular dependencies between the new split files
