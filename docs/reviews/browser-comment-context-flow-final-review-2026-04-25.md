## Review: Browser Comment Context Flow

### Findings

- **HIGH** — `packages/browser/src/comment-context-tool.ts:195`, `packages/browser-extension/src/content/page-map-collector.ts:83`, `packages/browser-extension/src/relay-forwarder-tab.ts:11`  
  Browser-created comments store a normalized page URL (`origin + pathname`), but rerun validation compares that stored value against `document.location.href`. A same-page rerun on `https://example.com/page?tab=details` will therefore fail with `context-mismatch` even when the stored comment was created on the same page path.  
  **Done when:** stored and rerun page identity use the same canonical form before mismatch checks, and there is a test covering query/hash variations that should still resolve successfully.

- **MEDIUM** — `packages/browser/src/comment-context-tool.ts:32`, `packages/browser-extension/src/content/comment-ui-mode.ts:48`, `packages/browser-extension/src/content/element-inspector-detail.ts:63`, `packages/browser-extension/src/content/dom-excerpt.ts:83`  
  Stored `textSnippet` metadata is whitespace-normalized at comment creation time, but rerun matching compares it against raw `textContent` / excerpt text without equivalent normalization. Elements containing line breaks or repeated spaces can therefore produce false `context-mismatch` failures on unchanged content.  
  **Done when:** rerun matching normalizes comparison text with the same whitespace rules used when storing `textSnippet`, and a regression test covers multiline / repeated-whitespace content.

- **MEDIUM** — `packages/browser/src/comment-context-tool.ts:75`, `packages/browser-extension/src/relay-page-frames.ts:93`  
  Frame-discovery preflight requests drop per-call origin-policy constraints. During stale-frame recovery, and during direct `inspect_element` / `get_dom_excerpt` frame targeting, the code fetches `get_page_map` without forwarding the caller's `allowedOrigins` / `deniedOrigins`, so the discovery step can inspect a broader page context than the request contract promises.  
  **Done when:** frame-discovery `get_page_map` requests preserve the same per-call origin-policy arguments as the parent request, and tests assert that blocked origins remain blocked during recovery/discovery paths.

### Open questions / assumptions

- I assumed browser-comment URLs are intended to follow the browser-extension's normalized `origin + pathname` identity, because creation and tab targeting already normalize URLs that way.
- I assumed stored `textSnippet` is meant to be a stable identity hint, not a raw-format fidelity field, since creation already collapses whitespace.
- I did not treat general size/modularity issues as findings unless they affected this exact investigation flow.

### Validation run

- `packages/browser`: `pnpm vitest run src/__tests__/comment-context-tool-runtime.test.ts src/__tests__/interactive-tool-runtime.test.ts src/__tests__/page-understanding-tools.test.ts` → **160 passing**
- `packages/browser-extension`: `pnpm vitest run tests/element-inspector.test.ts tests/enhanced-anchor.test.ts tests/page-understanding-actions.test.ts tests/service-worker.test.ts` → **172 passing**
- `packages/comments`: `pnpm vitest run src/__tests__/comment-tools.test.ts` → **87 passing**

### Summary

The flow is close, but I do **not** consider it fully reliable end to end for a browser-reviewing agent yet. The biggest remaining risk is false failure on otherwise-valid reruns: first via URL canonicalization drift, then via whitespace-sensitive textSnippet matching. The frame-discovery origin-policy gap is a smaller but still concrete contract problem for constrained investigations.
