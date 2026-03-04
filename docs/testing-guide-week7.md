# Manual Testing Guide — Week 7 (M41 + M41b)

**Status:** All 150 automated tests passing (37 SDK + 113 md-viewer).
**Purpose:** Walkthrough for manual verification before committing.

Modules covered:
| Module | Package | What it does |
|---|---|---|
| M41 | `@accordo/comment-sdk` | Webview pin rendering + comment UI (DOM library) |
| M41b-BID | `accordo-md-viewer` | BlockId plugin for block-level comment anchoring |
| M41b-IMG | `accordo-md-viewer` | Relative image URI resolver for webviews |
| M41b-TPL | `accordo-md-viewer` | HTML document template builder |
| M41b-CPE | `accordo-md-viewer` | `CommentablePreview` CustomTextEditorProvider |
| M41b-EXT | `accordo-md-viewer` | Extension entry point (activate, register provider + commands) |
| M41b-PBR | `accordo-md-viewer` | PostMessage bridge (webview ↔ CommentStore) |
| M41b-RND | `accordo-md-viewer` | Full-stack markdown renderer |

---

## 0. Pre-flight

```bash
cd /Users/Shared/dev/accordo
pnpm test
pnpm --filter @accordo/comment-sdk typecheck
pnpm --filter accordo-md-viewer typecheck
```

All three must exit 0 before proceeding.

---

## 1. M41 — `@accordo/comment-sdk`

The SDK is a vanilla DOM library — no VSCode needed. Manual testing requires a browser devtools console.

### 1.1 Build the SDK

```bash
cd /Users/Shared/dev/accordo
pnpm --filter @accordo/comment-sdk build
```

### 1.2 Basic sanity check in devtools

Open any web page, paste into the console:

```javascript
const container = document.createElement("div");
container.style.cssText = "position:relative; width:600px; height:400px; background:#1e1e1e; margin: 20px auto;";
document.body.appendChild(container);

const para = document.createElement("p");
para.setAttribute("data-block-id", "p:0");
para.textContent = "Alt+click me to add a comment";
para.style.cssText = "color:#ccc; padding:20px;";
container.appendChild(para);
```

Then copy-paste the compiled SDK source from `packages/comment-sdk/dist/sdk.js`.

**Checklist:**

- [ ] `.accordo-sdk-layer` created inside container with `pointer-events: none`
- [ ] `sdk.loadThreads([{ id:"t1", blockId:"p:0", status:"open", hasUnread:false, comments:[{id:"c1",author:{kind:"user",name:"Alice"},body:"Looks good",createdAt:"…"}] }])` renders a pin
- [ ] Pin has `.accordo-pin--open` class
- [ ] Clicking pin opens `.accordo-popover` with "Alice" and "Looks good"
- [ ] Popover has textarea and "Resolve" button
- [ ] Typing text and clicking "Reply" → `callbacks.onReply("t1", "<typed text>")`
- [ ] Clicking "Resolve" → `callbacks.onResolve("t1", "")`
- [ ] Clicking "Delete" → `callbacks.onDelete("t1", undefined)`
- [ ] Alt+clicking `para` opens `.accordo-inline-input` form
- [ ] Typing and clicking "Submit" → `callbacks.onCreate("p:0", "<typed text>", undefined)`
- [ ] Clicking "Cancel" closes form without firing `onCreate`
- [ ] `sdk.updateThread("t1", { hasUnread: true })` → `.accordo-pin--updated`
- [ ] `sdk.updateThread("t1", { status: "resolved" })` → `.accordo-pin--resolved`
- [ ] `sdk.removeThread("t1")` removes the pin
- [ ] `sdk.destroy()` removes the layer and all event listeners
- [ ] Only one popover at a time
- [ ] Clicking outside the popover closes it

---

## 2–6. CLI regression smoke test (automated)

All pure-Node modules (renderer, block-id-plugin, image-resolver, webview-template, preview-bridge) are covered by:

```bash
cd /Users/Shared/dev/accordo
pnpm build
pnpm test:smoke
```

Expected output:
```
── MarkdownRenderer ──   (19 checks)
── BlockIdPlugin ──      (7 checks)
── ImageResolver ──      (4 checks)
── WebviewTemplate ──    (11 checks)
── PreviewBridge ──      (11 checks)
────────────────────────────────────────
52 passed, 0 failed
```

The smoke test (`packages/md-viewer/scripts/smoke-test.mjs`) runs against the **compiled `dist/`** output, verifying that the build pipeline produces correct artefacts end-to-end. It is part of `pnpm check` (build → unit tests → smoke tests).

Modules that import `vscode` (`commentable-preview.ts`, `extension.ts`) are covered exclusively by the vitest unit tests via the vscode mock — they cannot run outside the extension host.

---

## 7. M41b-CPE / M41b-EXT — automated coverage check

These modules are covered by the unit test suite via the vscode mock. Confirm locally:

```bash
cd /Users/Shared/dev/accordo/packages/md-viewer
pnpm test
```

Expected: 7 test files, 113 tests — all green.

For `extension.ts` activation (`M41b-EXT-01..05`): commands `accordo.preview.open` / `accordo.preview.toggle` / `accordo.preview.openSideBySide` and the custom editor registration are also exercised in Section 8 (VSCode E2E).

---

## 8. End-to-end in VSCode

> **Requires Extension Development Host.** The `launch.json` has been updated to include `packages/md-viewer`. Press **F5** from this repo (or Run → "Launch Bridge + Editor") to start the EDH. It loads bridge + editor + comments + **md-viewer** together.

### 8.1 Open the preview

1. In the EDH window, open any `.md` file (e.g. this repo's `README.md`)
2. Right-click the file tab or the file in Explorer → **Open With…** → **Accordo Markdown Preview**
   - *(The option appears because `md-viewer` contributes `"priority": "option"` for `*.md`)*

Alternatively, use the command palette:
- `Ctrl/Cmd+Shift+P` → **Accordo: Open Markdown Preview**
- Or `Shift+Cmd+V` (keybinding for `accordo.preview.toggle`)

### 8.2 Rendering checklist

- [ ] Markdown renders with syntax highlighting (shiki, github-dark theme)
- [ ] Inline math: add `$E=mc^2$` → renders via KaTeX
- [ ] Block math: add `$$\sum_{i=0}^n i$$` → renders as display block
- [ ] Mermaid block renders `<div class="mermaid">` (JS renders client-side):
  ````
  ```mermaid
  graph TD
    A-->B
  ```
  ````
- [ ] Emoji shortcodes: `:rocket:` → 🚀
- [ ] Headings have `id` and `data-block-id` attributes (inspect with DevTools: F12)
- [ ] Tables, strikethrough `~~text~~`, task lists `- [x]` render correctly
- [ ] Admonition: `::: note\nImportant\n:::` → `<div class="admonition note">`
- [ ] Relative images resolve to `vscode-resource:` URIs (inspect `<img src>`)
- [ ] `<script>alert('xss')</script>` in the markdown does NOT appear in rendered output

### 8.3 Comment workflow

- [ ] **Alt+click** on a paragraph opens the inline input form
- [ ] Typing a comment and submitting creates a thread (visible in Comments panel)
- [ ] Comment pin appears on the correct block
- [ ] Clicking the pin opens the thread popover with the comment body
- [ ] Replying, resolving, and deleting work via the popover
- [ ] Resolved thread → pin turns green (`.accordo-pin--resolved`)
- [ ] New reply → pin turns amber (`.accordo-pin--updated`)

### 8.4 Commands

- [ ] `Accordo: Toggle Preview/Source` (`⇧⌘V`) toggles between preview and text editor
- [ ] `Accordo: Open Preview Side by Side` opens preview beside text editor

---

## 9. Pass criteria

| Check | Requirement |
|---|---|
| `pnpm test` all green | 37 SDK + 113 md-viewer + 298 bridge + 177 comments + 335 hub + 186 editor |
| `pnpm build && pnpm test:smoke` | 52/52 checks pass |
| `pnpm typecheck` in both packages | Exit 0 |
| No `:any` in source files | `grep -r ": any" packages/md-viewer/src packages/comment-sdk/src` → empty |
| No `console.log` in source files | `grep -rn "console\.log" packages/md-viewer/src packages/comment-sdk/src` → empty |
| VSCode E2E preview renders correctly (Section 8) | Manual sign-off |

Once all checks pass, approve for commit.



