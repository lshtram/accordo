## Review — m112-text — Phase B2 Re-review

### Scope
- Module: **M112-TEXT** (`browser_get_text_map`)
- Requirements: `docs/requirements-browser2.0.md` §3.15 (**B2-TX-001..010**)
- Files reviewed:
  - `packages/browser-extension/tests/text-map-collector.test.ts`
  - `packages/browser/src/__tests__/text-map-tool.test.ts`
- Baseline reference: `docs/reviews/m112-text-B.md`

### Evidence executed
1. Ran browser-side suite:
   - Command: `pnpm test --run -- src/__tests__/text-map-tool.test.ts`
   - Workdir: `packages/browser`
   - Result: **PASS** (`text-map-tool.test.ts` 35 passing; package total 334 passing)

2. Ran extension-side suite (expected RED against stub):
   - Command: `pnpm test --run -- tests/text-map-collector.test.ts`
   - Workdir: `packages/browser-extension`
   - Result: **EXPECTED RED** (`text-map-collector.test.ts` 41 failed with `M112-TEXT: collectTextMap not implemented`; package total 621 passing + 41 failed)
   - Failure mode is implementation-stub throw, not import/setup failure.

---

## Verdict on previous 5 findings

1. **HIGH (false-green conditional in `text-map-tool.test.ts`)**  
   **Status: PARTIALLY FIXED (still an issue)**
   - The original `if ("success" in result && result.success)` pattern was removed.
   - However, many tests now use:
     - `if ("success" in result) { expect(result.success).toBe(false); return; }`
   - This is still non-blocking for unexpected error responses: error path can pass instead of failing the success-path test.
   - Examples: lines around 181–184, 210–213, 233–236, 245–248, 297–300, 317–320, 426–429, 437–440, 455–458, 470–473, 484–487, 500–503, 545–548, 560–563, 574–577, 587–590.

2. **HIGH (missing B2-TX-004 RTL test in collector)**  
   **Status: FIXED**
   - Added RTL test in collector suite (`B2-TX-004 RTL...` around line 294).
   - It asserts descending `bbox.x` ordering within vertical bands for `document.dir = "rtl"`.

3. **MEDIUM (B2-TX-008 truncation used `<=` not exact N)**  
   **Status: FIXED**
   - Updated to exact assertion: `expect(result.segments.length).toBe(3)` and `truncated === true`.

4. **MEDIUM (B2-TX-009/010 additive compatibility weak)**  
   **Status: PARTIALLY FIXED (still weak)**
   - New test added (`B2-TX-010: Tool is purely additive...`, around 377–416).
   - It improves coverage of action union membership and invocation.
   - But it still does **not** assert actual MCP registry/tool-list surface where “new tool appears alongside existing tools unchanged” is proven at runtime.

5. **MEDIUM (shared `noopStore`)**  
   **Status: FIXED**
   - Tests now instantiate `new SnapshotRetentionStore()` per test; shared mutable fixture removed.

---

## New findings (not in previous review)

1. **MEDIUM — Incorrect expectation for B2-TX-008 max cap semantics**
   - **File:** `packages/browser-extension/tests/text-map-collector.test.ts` (around 504–509)
   - Current assertion: `expect(result.segments.length).toBe(MAX_SEGMENTS_LIMIT)` for `maxSegments: 5000`.
   - Requirement says max 2000 is an upper cap, not “must always return 2000”. On small pages, returned length should be actual segment count (<= cap).
   - This test can force wrong behavior and likely fail correct implementation.
   - **Required fix:** assert `segments.length <= MAX_SEGMENTS_LIMIT` and validate truncation behavior conditionally against actual total segment count.

---

## Requirement traceability (B2-TX-001..010)

- **Covered by tests:** B2-TX-001, 002, 003, 004 (including RTL), 005, 006, 007, 008, 009, 010.
- **Coverage quality concerns:**
  - Success-path assertions in browser-tool tests remain weakenable due non-failing error guards.
  - Additive compatibility still lacks true registry-level runtime assertion.

---

## Gate decision

## **CHANGES REQUIRED**

Implementation should **not** proceed yet.

### Required fixes before PASS
1. In `text-map-tool.test.ts`, replace all `if ("success" in result) { expect(result.success).toBe(false); return; }` blocks in success-path tests with **hard fail on error branch** (e.g., `throw new Error(...)` / `expect.fail(...)`), then perform unconditional success assertions.
2. Strengthen additive compatibility to assert runtime registry/tool-list invariants (new tool present, existing tools unchanged) rather than only union-type membership.
3. Fix `maxSegments respects maximum of 2000` test semantics to reflect cap behavior (upper bound), not forced exact length of 2000 on small fixtures.
