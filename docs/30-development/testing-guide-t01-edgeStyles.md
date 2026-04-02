# Testing Guide — T-01: edgeStyles in `accordo_diagram_patch`

**Module:** `accordo_diagram_patch` — edge styling via MCP tool  
**Package:** `accordo-diagram`  
**TDD cycle:** T-01 (Phase S → TDD)  
**Last updated:** 2026-04-03

---

## Section 1 — Automated Verification (agent-executable)

### 1.1 Unit Tests

**Command:**
```bash
cd /data/projects/accordo
pnpm --filter accordo-diagram test
```

**Expected output:** All 558 tests pass (22 test files).

**Test groups relevant to T-01:**

| Test ID | Group | What it verifies |
|---------|-------|-----------------|
| DT-59 | `patchHandler edgeStyles — T-01` | `strokeColor` stored at `layout.edges["A->B:0"].style.strokeColor` |
| DT-60 | `patchHandler edgeStyles — T-01` | `routing` stored at `layout.edges["A->B:0"].routing`, NOT in `.style` |
| DT-61 | `patchHandler edgeStyles — T-01` | Unknown edge key silently skipped (no crash, `result.ok === true`) |
| DT-62 | `patchHandler edgeStyles — T-01` | Unknown style fields silently dropped by whitelist |
| DT-63 | `patchHandler edgeStyles — T-01` | Absent `edgeStyles` param → edges unchanged (backwards compat) ✅ |
| DT-64 | `patchHandler edgeStyles — T-01` | Multiple fields in one call → all persisted |
| DT-65 | `patchHandler edgeStyles — T-01` | `routing` + style fields together → routing at edge level, styles in `.style` |
| DT-66 | `patchHandler edgeStyles — T-01` | Two-step partial patch → both fields survive (deep-merge guard) |

**To run only T-01 tests:**
```bash
pnpm --filter accordo-diagram test -- --testNamePattern="edgeStyles"
```

---

### 1.2 Static Analysis

**Type checker:**
```bash
cd /data/projects/accordo
pnpm --filter accordo-diagram run build
```
Expected: clean build, no TypeScript errors.

**To verify types without full build:**
```bash
cd /data/projects/accordo/packages/diagram
pnpm tsc --noEmit
```
Expected: no output (clean).

---

### 1.3 Deployed E2E Verification

**System under test:** Accordo VS Code extension (accordo-diagram package) running in a live VS Code instance with the MCP bridge connected.

**Prerequisites:**
- VS Code running with all Accordo extensions in dev mode (`./scripts/dev-open.sh`)
- A workspace open at `/data/projects/accordo`
- An MCP client connected (e.g., an AI agent session)

**E2E scenario — Style an edge via agent:**

1. Create a simple flowchart:
   ```
   flowchart TD
       A --> B
   ```
   Save as `test-edge-style.mmd` in the workspace.

2. Have an AI agent call:
   ```
   accordo_diagram_patch({
     "path": "test-edge-style.mmd",
     "content": "flowchart TD\n    A --> B",
     "edgeStyles": {
       "A->B:0": {
         "strokeColor": "#E74C3C",
         "strokeWidth": 2,
         "strokeStyle": "dashed",
         "routing": "orthogonal"
       }
     }
   })
   ```

3. **Expected result:**
   - `result.ok === true`
   - The file `.accordo/diagrams/<path>.layout.json` is updated:
     ```json
     {
       "edges": {
         "A->B:0": {
           "routing": "orthogonal",
           "waypoints": [],
           "style": {
             "strokeColor": "#E74C3C",
             "strokeWidth": 2,
             "strokeStyle": "dashed"
           }
         }
       }
     }
     ```

4. Open `test-edge-style.mmd` in VS Code — the edge between A and B should render with:
   - Red color (`#E74C3C`)
   - 2px stroke width
   - Dashed line style
   - Orthogonal (right-angle) routing

**E2E scenario — Unknown edge key is silently skipped:**

1. Call `accordo_diagram_patch` with `edgeStyles` referencing `"X->Y:0"` (which doesn't exist in the diagram).
2. **Expected:** `result.ok === true` (not an error), and the patch is silently ignored.

**E2E scenario — Partial style update (deep-merge):**

1. First patch: `{ "A->B:0": { "strokeColor": "#0000FF" } }`
2. Second patch: `{ "A->B:0": { "strokeWidth": 3 } }` — note: no `strokeColor` in second call
3. **Expected:** Both `strokeColor: "#0000FF"` AND `strokeWidth: 3` are preserved in the final layout.

**Why live E2E is mandatory here:** The MCP tool boundary involves JSON serialization/deserialization between the agent (JSON-RPC over WebSocket), the bridge, and the VS Code extension host process. A unit test mocks this boundary; only a live E2E confirms the real serialization path works.

**Residual risk if E2E is skipped:** The unit tests mock `patchHandler` directly and don't exercise the MCP JSON-RPC serialization. Without live E2E, a serialization mismatch between bridge and extension could go undetected.

---

## Section 2 — User Journey Verification

**Product:** AI agent using Accordo VS Code extension  
**User type:** Non-technical end user working with an AI coding assistant  
**Prerequisite:** User has the Accordo extension installed and an AI agent session active

### Journey 1 — Style a diagram edge

> **"I want the arrow between A and B to be red and dashed."**

**Steps:**

1. Open the diagram in VS Code (`.mmd` file). The diagram renders in the Accordo panel.
2. Tell your AI agent: "Make the arrow from A to B red and dashed."
3. The agent calls `accordo_diagram_patch` internally with the correct `edgeStyles` argument.
4. The diagram updates automatically — the arrow is now red and dashed.
5. The `.layout.json` file is updated so the style persists if you close and reopen the diagram.

**What to observe:** The edge changes color, thickness, and dash pattern immediately in the rendered diagram. No manual file editing required.

---

### Journey 2 — Change edge routing

> **"Make the connection between X and Y go with right-angle bends."**

**Steps:**

1. Open the diagram in VS Code.
2. Tell your AI agent: "Route the X to Y connection with right-angle bends."
3. The agent calls `accordo_diagram_patch` with `routing: "orthogonal"`.
4. The edge re-renders with a right-angle path instead of a straight or curved one.

**What to observe:** The edge path changes from the default "auto" routing to an orthogonal (horizontal/vertical) routing with sharp bends.

---

### Journey 3 — Partial style update

> **"First make the edge blue. Then also make it thick."**

**Steps:**

1. Tell your agent: "Make the A→B edge blue."
2. Agent patches with `{ strokeColor: "#0000FF" }`. Edge turns blue.
3. Tell your agent: "Also make it thicker."
4. Agent patches with `{ strokeWidth: 3 }` — no mention of color this time.
5. Edge is now **both** blue **and** thick.

**What to observe:** Both style properties are preserved. The second command didn't erase the blue color that was set by the first.

---

### Journey 4 — Style a non-existent edge gracefully

> **"Make the edge from X to Y red."** (when there is no edge X→Y)

**Steps:**

1. Tell your agent: "Make the edge from foo to bar red."
2. The agent calls `accordo_diagram_patch` with `edgeStyles: { "foo->bar:0": { "strokeColor": "red" } }`.
3. **What happens:** The patch call succeeds (`ok: true`). The agent may tell you "there's no edge foo→bar in this diagram" — or it may silently succeed if the diagram structure was already correct.

**What to observe:** The system does not crash or show an error dialog. The edge (if it exists) is styled. If it doesn't exist, the behavior is graceful — the agent should inform you.

---

## Edge Key Reference

Edges are keyed by their source and target node IDs plus an ordinal (for multi-edges between the same pair):

| Mermaid source | Edge key |
|---------------|----------|
| `A --> B` (first A→B edge) | `"A->B:0"` |
| `A --> B --> C` | `"A->B:0"`, `"B->C:0"` |
| `A --> B\nA --> B` (two edges) | `"A->B:0"`, `"A->B:1"` |

To find the exact edge keys in your diagram, check the `.layout.json` file — the `edges` object uses edge keys as property names.

---

## Troubleshooting

**Edge style not appearing in diagram:**
- Verify the edge key is correct (check `.layout.json`)
- Confirm the property name: `strokeColor`, `strokeWidth`, `strokeStyle`, `routing` — not `color`, `thickness`, etc.

**Style disappeared after closing and reopening:**
- This would be a bug. Check the `.layout.json` was saved correctly with your style in it.

**`result.ok === false`:**
- Check the error message — common causes: file not found, invalid JSON in `edgeStyles`, or the patch handler threw an unexpected error.
