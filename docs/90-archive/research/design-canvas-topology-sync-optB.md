# Option B: Simple Canvas → Mermaid Topology Sync

**Status:** DESIGN DRAFT  
**Date:** 2026-03-14  
**Scope:** Detect new/deleted nodes and edges on the Excalidraw canvas and round-trip them to `.mmd` + `.layout.json`  
**Prerequisite:** diag.1 complete (flowchart only)

---

## 1. Goal

Let the human add and remove nodes and edges directly on the Excalidraw canvas,
and have those changes reflected in the `.mmd` source file and `.layout.json`.
No AST manipulation — we use **text-level insertion/removal** of Mermaid lines.

This covers the 80 % use case:
- Draw a rectangle → new node appears in `.mmd`
- Draw an arrow between two nodes → new edge appears in `.mmd`
- Delete a node → its declaration and edges are removed from `.mmd`
- Delete an edge → its line is removed from `.mmd`

---

## 2. What It Does NOT Cover

- Copy-paste of existing nodes (would need ID dedup logic — out of scope)
- Cluster/subgraph creation from canvas
- Node shape changes from canvas (user picks a shape in Excalidraw — no Mermaid syntax mapping)
- Node ID editing (label changes don't rename the ID)
- Multi-edge labels or edge types from canvas
- Any non-flowchart diagram type

---

## 3. Detection: How We Know the User Added/Deleted Something

### 3.1 Current state

The webview already has `onPointerUpdate` diffing `prevElements` vs live elements.
`detectNodeMutations()` only looks at elements **that already exist in both snapshots**
(matched by Excalidraw element `id`). It does NOT detect:
- Elements in `next` that don't exist in `prev` (new elements)
- Elements in `prev` that don't exist in `next` (deleted elements)

### 3.2 New detection logic

Add two new functions to `message-handler.ts`:

```typescript
/** Detect elements in next that don't exist in prev (user added). */
function detectAddedElements(
  prev: ExcalidrawAPIElement[],
  next: ExcalidrawAPIElement[],
): ExcalidrawAPIElement[] {
  const prevIds = new Set(prev.map(el => el.id));
  return next.filter(el => !prevIds.has(el.id) && !el.isDeleted);
}

/** Detect elements in prev that are either missing or isDeleted in next. */
function detectDeletedElements(
  prev: ExcalidrawAPIElement[],
  next: ExcalidrawAPIElement[],
): ExcalidrawAPIElement[] {
  const nextMap = new Map(next.map(el => [el.id, el]));
  return prev.filter(el => {
    const n = nextMap.get(el.id);
    return !n || n.isDeleted;
  });
}
```

### 3.3 Triggering

These run in `handlePointerUpdate` (on `button === "up"`) alongside
`detectNodeMutations`. Also run in `handleChange` as a fallback.

**Filtering rules:**
- Only emit `canvas:node-added` for elements of type `rectangle`, `diamond`,
  `ellipse` (shapes that map to Mermaid nodes). Ignore text, arrow, freedraw, etc.
- Only emit `canvas:edge-added` for elements of type `arrow` **that have both
  `startBinding` and `endBinding`** pointing to elements with `customData.mermaidId`.
- Only emit `canvas:node-deleted` for elements that have `customData.mermaidId`
  (i.e. elements WE created from the Mermaid source). User-drawn elements that
  were never synced to Mermaid are ignored on delete.
- Only emit `canvas:edge-deleted` for arrows with `customData.mermaidId`
  containing `"->"` (edge key format).

### 3.4 ID generation for new nodes

When the user draws a new rectangle, it has no `mermaidId`. We need to assign one.

Strategy: **Auto-generate from label or sequence.**

```
1. If the element has bound text (Excalidraw creates a text element on
   double-click), use a sanitized version of the label: "Auth Service" → "AuthService"
2. If no label yet, generate "node_1", "node_2", etc.
   (incrementing from the highest existing numeric suffix in the current .mmd)
3. Deduplicate against existing Mermaid node IDs.
```

The generated ID is sent in the `canvas:node-added` message. The host writes it
to `.mmd`, then posts a `host:load-scene` refresh so the element gets
`customData.mermaidId` set (matching it to the layout store permanently).

---

## 4. Mermaid Source Writer (Text-Level)

This is the core new module. It does NOT parse the Mermaid AST — it works with
**lines of text** using simple patterns.

### 4.1 Module: `src/writer/mermaid-writer.ts`

```typescript
/** Append a node declaration line to a flowchart .mmd source. */
export function appendNode(
  source: string,
  nodeId: string,
  label: string,
  shape?: "rectangle" | "rounded" | "diamond" | "circle",
): string;

/** Append an edge declaration line to a flowchart .mmd source. */
export function appendEdge(
  source: string,
  fromId: string,
  toId: string,
  label?: string,
): string;

/** Remove a node declaration and all edges referencing it. */
export function removeNode(
  source: string,
  nodeId: string,
): string;

/** Remove a specific edge line from the source. */
export function removeEdge(
  source: string,
  fromId: string,
  toId: string,
  ordinal: number,
): string;
```

### 4.2 How appendNode works

```
Input:
  flowchart TD
    A[Client] --> B{API Gateway}
    B --> C[Auth Service]

appendNode(source, "D", "Data Service", "rectangle")

Output:
  flowchart TD
    A[Client] --> B{API Gateway}
    B --> C[Auth Service]
    D["Data Service"]
```

Rules:
1. Find the last non-empty line of the source.
2. Detect the indentation of existing node/edge lines (match first `  \w` line).
3. Append `{indent}{nodeId}["{label}"]` (with shape brackets per type).
4. Shape mapping: rectangle=`[]`, rounded=`()`, diamond=`{}`, circle=`(())`.

### 4.3 How appendEdge works

```
appendEdge(source, "B", "D", "data")

Output:
  ...existing lines...
    B -- data --> D
```

Rules:
1. Append `{indent}{fromId} --> {toId}` (no label) or
   `{indent}{fromId} -- {label} --> {toId}` (with label).
2. Place after the last line that references either `fromId` or `toId`
   (keeps related declarations close together).

### 4.4 How removeNode works

```
removeNode(source, "C")

Input:
  flowchart TD
    A[Client] --> B{API Gateway}
    B --> C[Auth Service]
    C --> E[(User DB)]

Output:
  flowchart TD
    A[Client] --> B{API Gateway}
```

Rules:
1. Remove any line matching `^\s*{nodeId}\s*[\[\(\{]` (node declaration).
2. Remove any line where `nodeId` appears as a source or target of an edge
   (regex: `\b{nodeId}\b.*-->` or `-->\s*{nodeId}\b`).
3. Preserve all other lines, including comments and empty lines.

### 4.5 How removeEdge works

Remove the Nth edge from `fromId` to `toId` (by ordinal).

Rules:
1. Scan lines for edges matching `\b{fromId}\b.*--.*{toId}\b`.
2. Count matches in order — remove the one at `ordinal` index.

### 4.6 Complexity and risk

This is **fragile**. Mermaid syntax has many forms:

```mermaid
A --> B                   %% simple
A -- "label" --> B        %% labeled
A -->|label| B            %% pipe-labeled
A & B --> C               %% multi-source
A --> B & C               %% multi-target
A -- label1 --> B -- label2 --> C  %% chained
```

Option B handles only the simple and labeled forms. Chained, multi-source/target,
and pipe-labeled edges are NOT handled for removal (they would require partial
line editing). They ARE handled for addition (we always write the simple form).

**Risk:** If the user's `.mmd` uses advanced syntax, `removeEdge` may fail to
find the line. In that case, the removal silently does nothing and the node
reappears on the next canvas refresh. This is acceptable for MVP — the user
can manually edit the `.mmd` file.

---

## 5. Host-Side Handlers (panel.ts)

### 5.1 _handleNodeAdded

```
1. Read current .mmd source
2. Call appendNode(source, msg.id, msg.label)
3. Call patchNode(layout, msg.id, { x: msg.position.x, y: msg.position.y,
                                     w: DEFAULT_W, h: DEFAULT_H, style: {} })
4. Write .mmd and .layout.json
5. Call _loadAndPost() to refresh the canvas (new element gets customData.mermaidId)
```

### 5.2 _handleNodeDeleted

```
1. Read current .mmd source
2. Call removeNode(source, msg.nodeId)
3. Remove nodeId from layout.nodes
4. Remove all edges referencing nodeId from layout.edges
5. Write .mmd and .layout.json
6. Call _loadAndPost() to refresh
```

### 5.3 _handleEdgeAdded

```
1. Read current .mmd source
2. Call appendEdge(source, msg.from, msg.to, msg.label)
3. Add edge layout entry with routing: "auto"
4. Write .mmd and .layout.json
5. Call _loadAndPost() to refresh
```

### 5.4 _handleEdgeDeleted

```
1. Parse msg.edgeKey → fromId, toId, ordinal
2. Read current .mmd source
3. Call removeEdge(source, fromId, toId, ordinal)
4. Remove edgeKey from layout.edges
5. Write .mmd and .layout.json
6. Call _loadAndPost() to refresh
```

---

## 6. File Changes Summary

| File | Change |
|---|---|
| `src/writer/mermaid-writer.ts` | **NEW** — 4 functions, ~200 lines |
| `src/webview/message-handler.ts` | Add `detectAddedElements`, `detectDeletedElements` |
| `src/webview/webview.ts` | Wire new detectors in `handlePointerUpdate` and `handleChange` |
| `src/webview/panel.ts` | Add `_handleNodeAdded`, `_handleNodeDeleted`, `_handleEdgeAdded`, `_handleEdgeDeleted` in message switch |
| `src/__tests__/mermaid-writer.test.ts` | **NEW** — test suite for the writer |
| `src/__tests__/message-handler.test.ts` | Add tests for add/delete detection |

---

## 7. Estimated Effort

| Component | Lines | Complexity |
|---|---|---|
| `mermaid-writer.ts` | ~200 | Medium — regex-based text manipulation |
| Detection in webview | ~80 | Low — straightforward set diff |
| Panel handlers | ~120 | Low — plumbing |
| Tests | ~300 | Medium — many edge cases in writer |
| **Total** | **~700** | **Medium** |

Estimated: **1–2 sessions** for core implementation + testing.

---

## 8. Limitations and Trade-offs

| Aspect | Assessment |
|---|---|
| **Syntax coverage** | Handles simple `A --> B` and `A -- label --> B`. Does not handle chained edges, multi-source/target, or pipe labels for removal. |
| **Node shapes from canvas** | New nodes always created as `rectangle`. User must edit `.mmd` to change shape. |
| **Copy-paste** | Excalidraw copy-paste creates new elements with no `mermaidId`. These are treated as new nodes. Labels may duplicate — user must rename. |
| **Undo** | No canvas-level undo for topology changes. The `.mmd` file has VS Code's text undo (if opened in an editor tab). |
| **Concurrent edits** | If the user edits the `.mmd` file at the same time as drawing on canvas, changes may conflict. Last-write-wins at the file level. |
| **Non-flowchart types** | No support — topology edits only work for flowchart. |
| **Robustness** | Regex-based writer can misfire on unusual formatting. Failure mode: silent no-op on removal, the node reappears on next refresh. |

---

## 9. Migration Path to Option C

Option B's `mermaid-writer.ts` is the only throwaway module. Everything else
(detection logic, protocol messages, panel handlers, tests) carries forward
directly into Option C. The writer module would be replaced by an AST-based
writer that handles all Mermaid syntax forms.

---

## 10. Review Comments (2026-03-14)

### 10.1 Overall Assessment

Option B is a strong MVP path for the exact current gap (human cannot add/remove
nodes and edges from canvas). It is feasible with the current codebase and does
not require disruptive refactors.

Architecture quality for this option is **good for short-term delivery**, with
clear limits that are already acknowledged in the document.

### 10.2 Fit With Current Implementation (Grounded Check)

The proposal fits current modules well:

- `src/webview/protocol.ts` already defines `canvas:node-added`, `canvas:node-deleted`,
  `canvas:edge-added`, `canvas:edge-deleted`.
- `src/webview/webview.ts` already has both `onChange` and `onPointerUpdate` hooks,
  so added/deleted detection can be integrated without a new event system.
- `src/webview/panel.ts` already owns the persistence flow (`read .mmd`, write layout,
  refresh via `_loadAndPost()`), so topology handlers belong there.
- `src/reconciler/reconciler.ts` already preserves layout identity and edge routing
  semantics; Option B can leverage this instead of adding parallel migration logic.
- `src/layout/layout-store.ts` already has focused mutators for node/edge patch/remove.

This means the proposal is mostly additive and low-risk for integration.

### 10.3 What Is Architecturally Strong

1. The design keeps `.mmd` as topology truth and `.layout.json` as layout truth, which
   matches `diag_arch_v4.2.md`.
2. The change boundary is clean: webview detection -> typed message -> panel mutation.
3. No VS Code surface or tool API redesign is required to ship canvas topology edit.
4. It is a pragmatic bridge to diag.2 without blocking current user workflow.

### 10.4 Critical Risks and Design Gaps

| Area | Why it is risky | Review recommendation |
|---|---|---|
| Duplicate emission | `onChange` + `onPointerUpdate` can emit the same add/delete operation twice | Add operation dedup in webview (short-lived seen-set keyed by element id + event type) or host-side idempotency checks |
| Writer/reconciler split | If panel mutates `.layout.json` directly and also rewrites `.mmd`, drift can happen | After writer mutation, always run `reconcile(oldSource, newSource, layout)` before final write |
| Silent failure on remove | Silent no-op causes "node reappears" with no explainability | Return explicit warning toast when remove regex did not match any edge/node |
| ID generation | Label-derived IDs can collide, be unstable, or violate naming conventions | Define one canonical `generateNodeId()` utility with strict normalize+dedupe rules and tests |
| Arrow binding extraction | Excalidraw arrows can bind to text or transient elements | Resolve bindings to base shape node IDs only; ignore non-node bindings |
| File race conditions | File watcher refresh + in-flight writes can interleave | Add single-flight write queue in panel for topology operations |
| Syntax safety | Regex editing on advanced Mermaid can produce wrong mutations | Preflight scan for unsupported edge forms; if found, reject canvas topology edit with clear message |

### 10.5 Feasibility Re-Estimate

The documented estimate ("1-2 sessions") is close, but optimistic if quality gates
are applied.

- **Core happy path:** feasible in 1-2 sessions.
- **Production-safe version with dedup, no-op warnings, and race control:** likely 2-3 sessions.

Reason: most effort is not raw line count; it is edge-case stabilization around
event semantics and text mutation safety.

### 10.6 Required Changes Before Merge (Must-Have)

1. Keep writer behind an interface (`TopologyWriter`) so Option C replacement is trivial.
2. Enforce idempotent host handlers for repeated `canvas:*` topology messages.
3. Gate operations when source contains unsupported syntax forms.
4. Remove "silent no-op" behavior; emit structured warning and log diagnostics.
5. Add deterministic node-id generation tests for collision and reserved suffix cases.
6. Add integration tests that verify `.mmd` + `.layout.json` stay consistent after each mutation.

### 10.7 Test Strategy Needed for This Option

Minimum test coverage to make Option B safe:

- Webview diff tests: add/delete detection for shapes, arrows, deleted flags, and filtered types.
- Panel handler tests: node add/delete + edge add/delete round-trips including file writes.
- Writer tests: append/remove with comments, blank lines, indentation variations, duplicate edges.
- Regression tests for duplicate event emission from both `onChange` and `onPointerUpdate`.
- Integration test: mutate from canvas message sequence and verify final parse via `parseMermaid()`.

### 10.8 Final Verdict on Option B

Option B is **feasible and good as an incremental architecture** if treated as a
guardrailed MVP, not a full syntax editor. It is the fastest credible way to fix
the user-facing topology edit gap now, and it aligns with a later Option C migration.
