## Review — m109-wait — Phase A (Re-review)

**Decision:** **PASS**

Re-reviewed files:
- `packages/browser/src/extension.ts`
- `packages/browser-extension/src/content/content-entry.ts`
- `docs/architecture.md`
- `docs/browser2.0-architecture.md`

Type/importability gate:
- `packages/browser`: `pnpm exec tsc --noEmit` ✅
- `packages/browser-extension`: `pnpm exec tsc --noEmit` ✅

### Prior findings status

1. **Tool registration gap** — ✅ Resolved  
   `browser_wait_for` is now registered in `packages/browser/src/extension.ts` via `buildWaitForTool(...)` and included in `allBrowserTools` before `bridge.registerTools()`.

2. **Relay → content dispatch gap** — ✅ Resolved  
   `packages/browser-extension/src/content/content-entry.ts` now handles `action === "wait_for"` and routes to `handleWaitForAction(payload)`.

3. **Core architecture doc missing new tool** — ✅ Resolved  
   `docs/architecture.md` §14.2 now lists `browser_wait_for` and describes its role in the page-understanding relay flow.

4. **Signature/documentation drift** — ✅ Resolved  
   `docs/browser2.0-architecture.md` now matches implementation contracts: `waitForStableLayout(stableMs, options)` and no `pageId` in `BrowserWaitOptions`.

### Concise rationale

All previously blocking Phase A issues are fixed, wiring is coherent end-to-end for the wait tool path, docs are aligned with implemented interfaces, and both affected packages remain type-clean.
