# Testing Guide — Session: Diagram Style Persistence Fix (F-2, F-3)

**Module:** `packages/diagram` (`scene-adapter.ts`, `message-handler.ts`)  
**Date:** 2026-03-31  
**Automated test baseline:** 515 tests passing in `accordo-diagram`; full monorepo: see `pnpm test`  
**TDD phases completed:** A → B → B2 → C → D → D2 → D3

---

## Section 1 — Automated Tests

### How to run

```bash
# diagram package only (515 tests)
cd /data/projects/accordo/packages/diagram && pnpm test

# Full monorepo
cd /data/projects/accordo && pnpm test
```

### Test file index

| Test file | Tests | What it covers |
|---|---|---|
| `message-handler.test.ts` | 16 | `detectNodeMutations()` — move/resize detection, style detection for all visual properties including fillStyle, strokeStyle, fontFamily; element-type guards (text/label/arrow exclusion) |
| `scene-adapter.test.ts` | 8 | `toExcalidrawPayload()` — fillStyle passthrough and default, fontFamily numeric→string mapping, element passthrough contracts |

### Key invariants (must stay green)

**`detectNodeMutations` — style detection:**
- `backgroundColor`, `strokeWidth`, `opacity` change on shape → `styled` mutation emitted
- `strokeColor` change on shape → `strokeColor` in style patch; on text element → `fontColor` in style patch
- `fontSize` change on text element → `fontSize` in style patch (shape elements: not emitted)
- `fillStyle` change on shape element → `fillStyle` in style patch (not emitted for text elements or edge arrows)
- `strokeStyle` change on shape element → `strokeStyle` in style patch (not emitted for text elements or edge arrows)
- `fontFamily` change on text element → string value (`"Excalifont"` / `"Nunito"` / `"Comic Shanns"`) in style patch; shape elements: not emitted
- Unknown `fontFamily` numeric values (e.g. `99`) → not emitted (guarded by `Partial<Record>` type + runtime check)
- Mutations for arrow elements (`mermaidId` contains `->`) → never emitted for `moved`, `resized`, or `styled`
- Mutations for `:label` elements → never emitted for `moved`, `resized`, or `styled`

**`toExcalidrawPayload` — fillStyle passthrough:**
- `ExcalidrawElement.fillStyle: "solid"` → `ExcalidrawAPIElement.fillStyle: "solid"` (not clobbered)
- `ExcalidrawElement` without `fillStyle` → `ExcalidrawAPIElement.fillStyle: "hachure"` (default)
- `fontFamily: "Nunito"` → numeric `2` in output; `"Comic Shanns"` → `3`; unknown → `1` (fallback)
- `strokeStyle`, `strokeColor`, `strokeWidth` → passthrough with same `??` defaults as `fillStyle`

**Round-trip integrity:**
- `layout.json` → `canvas-generator` → `ExcalidrawElement` → `toExcalidrawPayload` → Excalidraw (no loss of fillStyle/strokeStyle/fontFamily)
- User changes style in Excalidraw UI → `detectNodeMutations` emits `styled` mutation → `handleNodeStyled` patches `layout.json` → on reload, style is restored correctly

### What was fixed

| Bug | Root cause | Fix |
|---|---|---|
| F-2: fillStyle not persisted | `detectNodeMutations` never watched `fillStyle`; `toExcalidrawPayload` hardcoded `"hachure"` | Added detection in `message-handler.ts`; changed `fillStyle: "hachure"` → `rest.fillStyle ?? ("hachure" as const)` in `scene-adapter.ts` |
| F-3: fontFamily not persisted | `detectNodeMutations` never watched `fontFamily`; no reverse map from numeric (1\|2\|3) to string | Added `REVERSE_FONT_FAMILY_MAP` in `scene-adapter.ts`; added fontFamily detection in `message-handler.ts` (text elements only) |

---

## Section 2 — User Journey Tests

These scenarios describe a user changing node visual styles in the Accordo diagram panel and verifying the changes persist across reloads. All scenarios assume a working `.mmd` diagram open in VS Code via the Accordo extension.

### Journey 1 — Change fill style on a node, reload, verify it persists

**Purpose:** Verify that changing a node's fill pattern (e.g. from hachure to solid) is written to `layout.json` and restored on reload.

**Steps:**

1. Open a `.mmd` flowchart file in VS Code (e.g. any existing diagram in the workspace).
2. The diagram renders in the Accordo diagram panel. Note the visual appearance of a specific node — its current fill pattern.
3. In the Excalidraw panel (diagram panel), click the node to select it.
4. In the Excalidraw shape properties (right sidebar), change the fill pattern from the default to **Solid** (or Cross-hatch, or Zigzag).
5. Visually confirm the node's fill changes on the canvas.
6. **Close the diagram panel** (click elsewhere or close the tab).
7. **Re-open the same `.mmd` file** (click it in the explorer or use `accordo_editor_open`).
8. Wait for the diagram to re-render.

**Expected result:** The node retains the fill style you selected — it is not reset to the default hachure. The change survived the reload.

**Red flag:** The fill pattern reverts to the default on reload. The style was lost — either not detected, not patched, or overwritten on load.

---

### Journey 2 — Change stroke style on a node, reload, verify it persists

**Purpose:** Verify that changing a node's stroke style (solid → dashed) is persisted.

**Steps:**

1. Open a `.mmd` flowchart. Note a node's current stroke appearance.
2. Select the node in the Excalidraw panel.
3. In the shape properties, change the stroke style from **Solid** to **Dashed** (or Dotted).
4. Confirm the stroke style changes visually on the canvas.
5. Close the diagram panel.
6. Re-open the same `.mmd` file.
7. Wait for re-render.

**Expected result:** The node's stroke remains dashed. Change persisted.

**Red flag:** Stroke resets to solid on reload.

---

### Journey 3 — Change font family on a node, reload, verify it persists

**Purpose:** Verify that changing a node's font (Excalifont → Nunito) is persisted.

**Steps:**

1. Open a `.mmd` flowchart with labeled nodes.
2. Select a node's text label (click the node to select it, then click the text label inside it).
3. In the Excalidraw text properties, change the font family from **Excalifont** to **Nunito** (or Comic Shanns).
4. Confirm the text rendering changes visually.
5. Close the diagram panel.
6. Re-open the same `.mmd` file.
7. Wait for re-render.

**Expected result:** The text remains in Nunito. The change persisted.

**Red flag:** Font resets to Excalifont on reload.

---

### Journey 4 — Change multiple style properties simultaneously, verify all persist

**Purpose:** Verify that combined style changes (fill + stroke + font) are all persisted together.

**Steps:**

1. Open a `.mmd` flowchart.
2. Select a node.
3. Change fill to **Solid**, stroke to **Dashed**, and font to **Nunito** — all three in the same session.
4. Close and re-open the `.mmd` file.
5. Inspect the node.

**Expected result:** All three style properties are retained. No property is lost or reset independently.

**Red flag:** Only some properties persist — e.g. fill persists but font resets. This suggests a partial detection failure.

---

### Journey 5 — Agent uses MCP tool to change styles, then user reloads

**Purpose:** Verify that style changes made via the MCP `diagram_tool_ops` interface are also persisted and survive reload.

**Steps:**

1. Open a `.mmd` flowchart.
2. Have an AI agent call `diagram_tool_ops` with a `nodeStyles` patch to change a node's `fillStyle` or `fontFamily`.
3. The diagram should update in real time.
4. Close and re-open the `.mmd` file.
5. Inspect the node.

**Expected result:** The agent's style change is visible and persists across reload.

**Note:** The MCP tool path (`diagram_tool_ops` → `panel-core.ts`) uses the same `patchNode` → `patchLayout` pipeline as the canvas UI path. If Journey 1–4 pass, this should also work.

---

### Journey 6 — Style changes on edge arrows are not persisted (edge case)

**Purpose:** Confirm that changing fill/stroke on edge arrows does not corrupt `layout.json` with spurious node entries.

**Steps:**

1. Open a `.mmd` flowchart with visible edges between nodes.
2. Select an edge arrow (may require clicking directly on the arrow line).
3. Try to change the arrow's fill or stroke style. Note: Excalidraw may not expose fill styling on arrows — if the property is not available in the UI, skip this step.
4. Close and re-open the `.mmd` file.
5. Confirm the diagram loads without errors and no spurious entries appear in `layout.json`.

**Expected result:** Arrow style changes either work correctly (if Excalidraw exposes them) or are silently ignored. No crash or data corruption.

**Note:** If Excalidraw does not support per-arrow fill/stroke in the UI, this journey is informational only.

---

### Setup checklist (before running any journey)

- [ ] `accordo-diagram` extension active — check VS Code extension panel
- [ ] `.mmd` file exists in workspace — any flowchart or diagram file
- [ ] Diagram panel opens without error — if the panel shows a parse error, fix the `.mmd` source first
- [ ] Can select nodes in the Excalidraw canvas — nodes highlight with resize handles when selected
- [ ] `packages/diagram` build is current — if recent changes, run `pnpm --filter accordo-diagram build` before testing

---

## What to check if a journey fails

| Symptom | Where to look |
|---|---|
| Fill/stroke reverts on reload but Journey 1–2 show correct detection in tests | `layout.json` not updated — check `patchLayout` debounce (100ms); check `writeLayout` succeeds |
| Fill/stroke reverts and `detectNodeMutations` tests pass | `toExcalidrawPayload` is overwriting the value on load — check `fillStyle` line (scene-adapter.ts) |
| Font reverts on reload but `REVERSE_FONT_FAMILY_MAP` tests pass | Numeric→string conversion missing — check `handleNodeStyled` receives `fontFamily` as number not string |
| Test suite shows FAIL but code matches design | Run `pnpm --filter accordo-diagram test` to confirm baseline is green before manual testing |
