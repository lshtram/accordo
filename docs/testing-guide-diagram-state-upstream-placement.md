# Testing Guide — diagram-state-upstream-placement

**Package:** `accordo-diagram`  
**Module:** `diag.2.6 / SUP-S — stateDiagram-v2 upstream placement`  
**Phase:** D3  
**Date:** 2026-04-17

---

## Section 1 — Automated tests

All commands were executed from:

```bash
cd /data/projects/accordo/packages/diagram
```

### 1.1 Full package regression

```bash
pnpm test -- --run
```

**Result:** `1005 passed, 0 failed`  
**Verifies:** the full diagram package remains green after adding stateDiagram-v2 upstream placement in the real product path.

### 1.2 Type safety

```bash
pnpm typecheck
```

**Result:** clean (no TypeScript errors).  
**Verifies:** host + webview TypeScript contracts remain valid after the new state placement path, runtime shim reuse, and load-race guard.

### 1.3 State upstream placement requirement suite

```bash
pnpm test -- --run src/__tests__/state-placement.test.ts
```

**Verifies:**
- **SUP-S01:** `layoutWithExcalidraw()` accepts `stateDiagram-v2` and produces layout output.
- **SUP-S02:** pseudostates are matched from upstream geometry, including unlabeled ellipses.
- **SUP-S03:** composite states produce normalized cluster bounds.
- **SUP-S04:** unmatched state nodes still fall back safely.
- **SUP-S05:** upstream placement survives through state-specific placement behavior.
- **SUP-S06:** debug instrumentation is gated and safe.
- **SUP-S07:** supported upstream state geometry types are accepted by the mapper.

### 1.4 Real first-init host-path coverage

```bash
pnpm test -- --run src/__tests__/panel-core.test.ts src/__tests__/panel-scene-loader-race.test.ts
```

**Verifies:**
- first-init `stateDiagram-v2` seeding goes through `layoutWithExcalidraw()` in the real loader path.
- stale overlapping loads cannot overwrite newer upstream-seeded layout data.
- reopen/view continues to use persisted `layout.json` without re-seeding.

### 1.5 Built runtime smoke check

Executed from repo root:

```bash
cd /data/projects/accordo
 node --input-type=module -e "import { readFile } from 'node:fs/promises'; import { parseMermaid } from './packages/diagram/dist/parser/adapter.js'; import { layoutWithExcalidraw } from './packages/diagram/dist/layout/excalidraw-engine.js'; const source = await readFile('./demo/state/state-01-simple.mmd', 'utf8'); const parsed = await parseMermaid(source); if (!parsed.valid) throw new Error(parsed.error.message); const layout = await layoutWithExcalidraw(source, parsed.diagram); console.log(JSON.stringify({ ok: true, nodeCount: Object.keys(layout.nodes).length, edgeCount: Object.keys(layout.edges).length, clusterCount: Object.keys(layout.clusters).length }));"
```

**Result:** completed successfully.  
**Verifies:** the built extension-host/runtime path can execute state upstream placement without falling back due to missing DOM/import timing issues.

---

## Section 2 — User journey tests

### Journey 1 — First open creates upstream-seeded layout for a simple state diagram
1. Delete `.accordo/diagrams/demo/state/state-01-simple.layout.json` if it exists.
2. Open `demo/state/state-01-simple.mmd` in the diagram editor.
3. **Expected:** the diagram opens without errors.
4. **Expected:** a new `.layout.json` file is created.
5. **Expected:** the saved node coordinates are compact upstream-style values (for example `root_start` near `x: 9, y: 8`, `Idle` near `x: 8, y: 72`) rather than the older dagre-style values (`x: 0/75`, `y: 0/110/250/...`).

### Journey 2 — First open creates upstream-seeded layout for a composite state
1. Delete `.accordo/diagrams/demo/state/state-03-composite.layout.json` if it exists.
2. Open `demo/state/state-03-composite.mmd` in the diagram editor.
3. **Expected:** the diagram opens without errors.
4. **Expected:** a new `.layout.json` file is created.
5. **Expected:** node positions are compact upstream-style values.
6. **Expected:** the `Session` cluster box is also compact and matches the node region (for example around `x: -12, y: 24, w: 126, h: 339`), not the older large dagre box (`x: 20, y: 222, w: 220, h: 378`).

### Journey 3 — Reopen preserves persisted layout
1. Open `demo/state/state-01-simple.mmd` once to generate its `.layout.json`.
2. Close the diagram.
3. Reopen the same file.
4. **Expected:** the diagram reopens using the persisted layout with no visible jump or re-seed.
5. **Expected:** the saved coordinates in `.layout.json` remain unchanged after reopen.

### Journey 4 — Reopen preserves composite-state layout
1. Open `demo/state/state-03-composite.mmd` once to generate its `.layout.json`.
2. Close and reopen it.
3. **Expected:** both node positions and the `Session` cluster bounds remain stable.
4. **Expected:** the file stays on the `metadata.engine = "excalidraw"` path and does not regress to dagre-style layout values.

### Journey 5 — Rapid reopen does not corrupt layout
1. Open and close `demo/state/state-01-simple.mmd` several times quickly.
2. Repeat for `demo/state/state-03-composite.mmd`.
3. **Expected:** layout files remain stable and are not overwritten by stale loader passes.

---

## Notes

- Real end-to-end verification was performed in the VS Code development session after rebuilding and reloading the extension stack.
- A jsdom canvas warning may appear in direct Node verification, but the placement call completes successfully and the persisted product-path layout is correct.
