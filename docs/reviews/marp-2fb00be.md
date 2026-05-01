## Review — marp — commit 2fb00be

### Verdict: FAIL

### Scope reviewed
- Commit: `2fb00be` — `refactor(marp): extract webview script segment builders`
- Files:
  - `packages/marp/src/marp-webview-html.ts`
  - `packages/marp/src/marp-webview-script-segments.ts`

### Evidence gathered
- `pnpm test` in `packages/marp` — **311 passing, 0 failing**
- `pnpm typecheck` in `packages/marp` — **clean**
- Reviewed commit diff against parent and current tests in `packages/marp/src/__tests__/marp-webview-html.test.ts`

### PASS
- No direct behavioral regression was found in the reviewed diff.
- Runtime assembly order is preserved: base variables → slide activation → navigation → message handler → keyboard handler → alt-click handler → SDK init → SDK message handlers → `webview:ready`.
- Package tests pass (`311/311`) and package typecheck is clean.
- No new `any`, debug logging, or obvious unsafe casts were introduced in the changed files.

### FAIL — must fix

1. **BLOCKER — modularity rule violated**  
   **File:** `packages/marp/src/marp-webview-script-segments.ts:1-303`  
   The extracted helper file is **303 lines**, which violates the reviewer iron rule (`<= 150` lines per file). This alone blocks approval.

   **Required fix:** Split this file into smaller focused modules, for example:
   - `marp-webview-sdk-assets.ts`
   - `marp-webview-sdk-runtime.ts`
   - `marp-webview-navigation-runtime.ts`
   - `marp-webview-message-runtime.ts`

2. **BLOCKER — multiple functions exceed the 30-line limit**  
   **Functions:**
   - `buildSdkInitScript` — `packages/marp/src/marp-webview-script-segments.ts:29-78`
   - `buildSdkMessageHandlers` — `packages/marp/src/marp-webview-script-segments.ts:85-123`
   - `buildMessageHandler` — `packages/marp/src/marp-webview-script-segments.ts:209-262`

   These violate the reviewer iron rule (`<= 30` lines per function) and reduce confidence in a string-built runtime path where ordering and punctuation matter.

   **Required fix:** Split each long builder into smaller segment builders, e.g. separate builders for:
   - SDK namespace/init
   - `refreshPins`
   - `coordinateToScreen`
   - SDK callbacks
   - comment mutation handlers
   - comment focus handler
   - marp update handler

3. **MEDIUM — regression tests are still too string-oriented for the refactored runtime fragments**  
   **Test file:** `packages/marp/src/__tests__/marp-webview-html.test.ts:67-374,546-632`  
   Most checks for the moved logic still assert substring presence. The executable harness covers startup, stale `marp:update` revisions, and pin refresh, but it does **not** execute the highest-risk moved flows:
   - `comments:focus` navigation + `sdk.openPopover`
   - Alt+click block-id generation / temporary `data-block-id`

   **Required fix:** Add executable harness tests for those flows. Prefer behavior assertions over substring assertions for code that is now assembled from multiple string builders.

4. **LOW — stale / misleading internal documentation in the new builder file**  
   **File:** `packages/marp/src/marp-webview-script-segments.ts:203-209,279-285`  
   `buildMessageHandler(_hasSdk: boolean)` does not use `_hasSdk`, and the assembly note says the inline branch handles `comments:focus`, which is no longer true in that function. This is not a runtime bug today, but it raises maintenance risk in already stringly runtime code.

   **Required fix:** Remove the unused parameter and update the comments to match the actual assembly responsibilities.

### Residual risk note
- I did not find a concrete behavior break in the generated webview runtime.
- However, this refactor moved fragile inline JS into a larger string-builder surface, so the missing executable coverage on `comments:focus` and Alt+click leaves meaningful regression risk.
- Even without a runtime regression, the modularity violations are automatic blockers under reviewer rules.
