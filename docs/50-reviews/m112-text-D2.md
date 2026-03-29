## Review — m112-text — Phase D2

### 1) Evidence executed (commands + results)

#### Test suites
- `cd packages/browser-extension && pnpm test --run`
  - **Result:** PASS — `32` test files, `662` tests passing, `0` failing.
- `cd packages/browser && pnpm test --run`
  - **Result:** PASS — `15` test files, `335` tests passing, `0` failing.

#### Type check
- `cd packages/browser-extension && npx tsc --noEmit`
  - **Result:** PASS — no TypeScript errors reported.

#### Lint / static checks executed during review
- `cd packages/browser-extension && pnpm lint`
  - **Result:** package script prints `no lint configured yet`.
- `cd packages/browser && pnpm lint`
  - **Result:** warnings in `src/eval-harness.ts` only (outside M112-TEXT scope); no errors.
- `cd packages/browser && npx eslint src/text-map-tool.ts src/__tests__/text-map-tool.test.ts`
  - **Result:** files ignored by current ESLint config (no direct lint verdict for M112 files).

#### Security tooling attempts (review-skill pack)
- `semgrep --metrics=off ...`
  - **Result:** not available in environment (`semgrep: command not found`).
- `codeql version`
  - **Result:** not available in environment (`codeql not installed`).

---

### 2) Requirement traceability (B2-TX-001..010)

- **B2-TX-001 (text extraction + ordering):** **PASS**
  - `collectRawSegments()` extracts element direct text runs; `assignReadingOrder()` sorts top→bottom then x-order within band.
  - Covered by collector tests in `text-map-collector.test.ts` (B2-TX-001 block).

- **B2-TX-002 (nodeId + bbox):** **PASS**
  - `nodeId` assigned sequentially per call (`nodeIdCounter++`), bbox from `getBoundingClientRect` path.
  - Covered in collector and tool-shape tests.

- **B2-TX-003 (raw vs normalized text):** **PASS**
  - `textRaw` preserves original direct text; `textNormalized` collapses whitespace and trims.

- **B2-TX-004 (reading order + tolerance 5px + RTL):** **PASS**
  - `VERTICAL_BAND_TOLERANCE_PX = 5` exported and used in sort logic.
  - RTL branch (`doc.dir === "rtl"`) implemented and tested.

- **B2-TX-005 (visibility states):** **PASS**
  - Hidden/offscreen/visible implemented via computed style + viewport intersection checks.

- **B2-TX-006 (role + accessible name):** **PASS**
  - Explicit role preferred, implicit role mapping present, accessible name priority `aria-label > alt > title`.

- **B2-TX-007 (SnapshotEnvelope fields):** **PASS**
  - Collector uses `captureSnapshotEnvelope("dom")`; tool validates with `hasSnapshotEnvelope` and persists snapshot.

- **B2-TX-008 (maxSegments defaults/limit/truncation):** **PASS (implementation)**
  - `DEFAULT_MAX_SEGMENTS=500`, `MAX_SEGMENTS_LIMIT=2000`, truncation + `totalSegments` pre-cap count implemented.

- **B2-TX-009 (tool registration contract):** **PASS**
  - Tool name `browser_get_text_map`, `dangerLevel: "safe"`, `idempotent: true`, schema includes `maxSegments` bounds.

- **B2-TX-010 (additive only):** **PASS**
  - New action added to `BrowserRelayAction` and tool appended in registration (`extension.ts`) without removing existing tools.

---

### 3) Code quality findings (severity)

### MEDIUM
- **`packages/browser/src/__tests__/text-map-tool.test.ts:114-115`**
  - Uses `// eslint-disable-next-line @typescript-eslint/no-explicit-any` and `Promise<any>`.
  - Violates review checklist requirement: **No `any` types** and **No eslint-disable without justification**.
  - **Fix:** remove `any` by giving `invokeToolHandler` an explicit union return type and invoking `tool.handler` via a typed function signature using `unknown`/concrete union types.

- **`packages/browser-extension/tests/text-map-collector.test.ts` (missing explicit edge-case assertions)**
  - Required edge-case checks requested for D2 are not explicitly present:
    1) empty page returns `segments=[]`, `truncated=false`, `totalSegments=0`
    2) page with text but all hidden returns hidden segments
  - Current suite has mixed-visibility assertions but no dedicated all-hidden/empty-page scenarios.
  - **Fix:** add dedicated tests for both scenarios.

### LOW
- **Residual security tooling coverage limitation**
  - `semgrep` and `codeql` are not installed in this environment, so automated security scan depth is reduced for this review run.

---

### 4) Architecture constraints check

- **No `vscode` imports in reviewed M112 implementation files:** PASS
  - `packages/browser-extension/src/content/text-map-collector.ts` — no vscode import.
  - `packages/browser/src/text-map-tool.ts` — no vscode import.
- **No runtime side effects at module level (reviewed files):** PASS
  - Module-level constants/types only; behavior triggered via exported functions/tool handlers.
- **No circular-import signal in reviewed path:** PASS (none observed in import graph of reviewed files).

---

### 5) Gate decision

## CHANGES REQUIRED

Implementation behavior is largely correct and tests/typecheck are green, but D2 gate is blocked by:
1. `any` + `eslint-disable` in `text-map-tool.test.ts`.
2. Missing explicit D2 edge-case tests (empty page and all-hidden page) in collector tests.

After these are fixed, re-run D2 review.
