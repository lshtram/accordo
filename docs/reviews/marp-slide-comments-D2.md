## Review — marp-slide-comments — Phase D2 (re-review)

### PASS
- Tests: 290 passing, zero failures (`pnpm test` in `packages/marp`)
- Type check: clean (`pnpm typecheck` in `packages/marp`)
- Build: clean, including SDK asset bundle/copy (`pnpm build` in `packages/marp`)
- Real production path checks in scope now pass:
  - SDK assets are produced into `dist/` (`sdk.browser.js`, `sdk.css`) via `scripts/copy-webview-assets.mjs` and wired in `package.json` build script
  - `PresentationProvider` computes webview URIs with `panel.webview.asWebviewUri(...)`, passes them to `buildWebviewHtml(...)`, and rebinds `PresentationCommentsBridge` to real `panel.webview.postMessage`
  - `onDidReceiveMessage` is consolidated with `webview:ready` handling + normal routing in a single registration
  - Navigation registry `focusThread` routes to canonical `accordo.presentation.internal.focusThread` with full context (`uri`, `threadId`, `blockId`)

### FAIL — must fix before Phase E
- None (no concrete blocking findings in reviewed scope)
