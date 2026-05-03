---
patterns:
  P-12: "VS Code Comments panel has no extensible context menu — need custom TreeView"
  P-13: "Extension Host restart does NOT restart Hub — kill Hub PID first"
  P-14: "Hub dist is per-file tsc output, not a bundle — grep specific dist/*.js files"
  P-21: "Custom editor cold-open needs onCustomEditor activation event alongside onStartupFinished"
  P-22: "TreeItem has no two-line layout — description renders beside label; need WebviewView for detail"
  P-23: "group field on ToolRegistration is metadata only — ALL tools always visible; no progressive disclosure"
  P-24: "Narrated presentation scripts must dry-run cleanly before TTS — runner skips unsupported command steps"
---

# accordo-patterns.md — Accordo-Specific Patterns

> Patterns specific to the Accordo IDE project (VS Code extensions, Hub, Bridge).
> Generic agent patterns are in `patterns.md`.
>
> **Quick scan:** Read the YAML header above. Load full sections only when relevant.

---

## P-12 — VS Code Comments panel has no extensible context menu

The built-in Comments panel does **not** honour `view/item/context` menu contributions.
Only extension-contributed `TreeView` instances support custom context menus.

- **What works:** Inline gutter widget (`comments/commentThread/title` buttons), webview preview popover.
- **Resolution:** Custom Accordo Comments TreeView sidebar panel (deferred — see workplan.md).

---

## P-13 — Extension Host restart does NOT restart the Hub

The Bridge reconnects to an existing Hub on port 3000 without spawning a new one.

**To pick up a new Hub build:**
1. `ps aux | grep hub/dist | grep -v grep` → find PID
2. `kill <PID>`
3. Restart Extension Host — Bridge will spawn a fresh Hub.

---

## P-14 — Hub dist is per-file, not a bundle

`tsc -b` compiles each source file to its own `.js` in `dist/`. Don't grep only `dist/index.js`.

- Grep specific files: `dist/prompt-engine.js`, `dist/server.js`, `dist/bridge-server.js`
- Or search all: `grep -r "symbol" packages/hub/dist/ --include="*.js" -l`

---

## P-21 — Custom editor activation: `onStartupFinished` misses cold-open

VS Code fires `onCustomEditor:<viewType>` *before* `onStartupFinished` on cold start.

- **Fix:** Add both activation events:
```json
"activationEvents": ["onStartupFinished", "onCustomEditor:accordo.deckPresentation"]
```

---

## P-22 — `TreeItem` has no native two-line layout (technical debt)

`vscode.TreeItem` only has `label` + `description` (same line). No multi-line field exists.

- **Current workaround:** Metadata + first-sentence in `item.description`.
- **Full fix (deferred to M46):** `WebviewView` detail pane alongside TreeView.
---

## P-23 — `group` field is metadata only — ALL tools always visible

**Symptom:** Agent (or developer) assumes that setting `group: "voice"` (or any group) on an
`ExtensionToolDefinition` / `ToolRegistration` hides those tools from the agent until a
`accordo_<group>_discover` tool is called. This is **wrong**.

**Reality (as of current implementation):**
- Hub's `toMcpTools()` **strips** `group` from the MCP wire output but includes every tool
  regardless of whether `group` is set.
- The system prompt (`GET /instructions`) includes **all** registered tools — grouped and ungrouped.
- MCP `tools/list` returns **all** registered tools.
- `group` is purely a categorisation label. It survives the Bridge → Hub registration payload
  and is available for UI/filtering but has **no effect on tool visibility**.
- There is **no progressive-disclosure mechanism** in the current codebase. The design was
  proposed and then removed. The tests that confirm this:
  - `packages/hub/src/__tests__/tool-registry.test.ts`: *"toMcpTools includes grouped tools
    (MCP tools/list is unfiltered)"*
  - `packages/hub/src/__tests__/prompt-engine.test.ts`: *"grouped tools are included in the
    prompt alongside ungrouped tools"*

**What `accordo_<group>_discover` tools DO instead:**
Their value is **runtime state inspection** — reporting provider availability, current FSM
state, current policy, etc. They are not a gate to unlock other tools.

**Sources to update if you find stale progressive-disclosure language:**
- `packages/bridge-types/src/index.ts` — JSDoc on `group` field
- `docs/architecture.md` — §3.7 description
- `docs/requirements-hub.md` — template structure section
- Test comments mentioning "forwarded for progressive disclosure"

---

## P-24 — Narrated presentation scripts must dry-run cleanly before TTS

`skills/script-authoring/accordo-run.py` does not accept the generic `command`
step shown in older examples. It skips unknown step types and continues, which can
produce a voice-only presentation where slides never advance.

- **Rule:** Before live narrated playback, always run `python3 skills/script-authoring/accordo-run.py <script.json> --dry-run` and verify there are no `unknown step type` warnings.
- **Rule:** Dry-run output must show slide navigation (`slide_open`, `slide_goto`, `slide_next`, or `slide_prev`) before each `speak` block.
- **Rule:** Do not validate by playing narration aloud. A live narrated deck has one audience pass; rerunning a corrected version after a voice-only failed pass is not acceptable.
- **Runner vocabulary:** use `layout`, `slide_open`, `slide_goto`, `slide_next`, `slide_prev`, `open`, `close`, `highlight`, `clear_highlights`, `speak`, `delay`, and `call`.
- **Escape hatch:** use `{ "type": "call", "tool": "accordo_tool_name", "args": { ... } }` for arbitrary Accordo tools.

---
