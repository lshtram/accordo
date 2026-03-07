---
patterns:
  P-12: "VS Code Comments panel has no extensible context menu — need custom TreeView"
  P-13: "Extension Host restart does NOT restart Hub — kill Hub PID first"
  P-14: "Hub dist is per-file tsc output, not a bundle — grep specific dist/*.js files"
  P-21: "Custom editor cold-open needs onCustomEditor activation event alongside onStartupFinished"
  P-22: "TreeItem has no two-line layout — description renders beside label; need WebviewView for detail"
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
