# Testing Guide — accordo-md-viewer

## 1) Automated tests

Run from repo root:

```bash
pnpm --filter accordo-md-viewer test -- --run
```

Expected result (as of 2026-04-21): **131 passing tests across 7 files**.

What this suite verifies:

- `renderer.test.ts` — markdown rendering pipeline (GFM features, KaTeX, mermaid placeholders, heading anchors, sanitisation, image rewriting behavior).
- `block-id-plugin.test.ts` — stable `data-block-id` generation and resolver mapping.
- `image-resolver.test.ts` — relative/absolute image URI handling and non-throwing fallbacks.
- `webview-template.test.ts` — CSP/template generation, SDK bootstrapping hooks, reveal handling.
- `preview-bridge.test.ts` — host↔webview message handling for create/reply/resolve/reopen/delete and pending create flush semantics.
- `commentable-preview.test.ts` — custom editor lifecycle, ready-gated thread loading, queued reveal behavior.
- `extension.test.ts` — extension activation wiring and command/provider registrations.

## 2) User journey tests

1. **Open markdown preview**
   - In VS Code Explorer, right-click a `.md` file and choose **Open With… → Accordo Markdown Preview**.
   - Expected: the custom preview opens and renders headings, lists, code blocks, and links.

2. **Create a comment in preview**
   - Hover a rendered block (for example a heading or paragraph) and create a comment.
   - Expected: a comment pin appears at the correct block and a new thread appears in the comments panel.

3. **Focus a comment thread from comments panel**
   - Click a markdown-preview thread in the comments panel.
   - Expected: the preview surface is focused and scrolled to the correct block.

4. **Open markdown with line targeting from editor tools**
   - Trigger an editor open action with `.md` + line input (for example via agent/tool call that opens the file at a line).
   - Expected: preview opens and scrolls to the block mapped from that line.

5. **Reply and resolve flow**
   - Reply to an existing preview thread, then resolve it.
   - Expected: comment state updates in preview pins and comments panel without needing manual refresh.
