# Browser MCP — Architecture Decision Records for Gaps A4, G6, E4

**Date:** 2026-04-06
**Status:** Proposed
**Context:** v4 evaluation scored 37/45. Three gaps remain at ❌ or 🟡 that require design-level changes: A4 (iframe frame lineage), G6 (screenshot artifact transport), and E4 (WebP format support).

---

## ADR-1: Iframe Frame Lineage (A4 / C3)

### Problem Statement

When an agent calls `get_page_map({ traverseFrames: true })` on a page with iframes (e.g., W3Schools "Try It" editor), two failures occur:

1. **No lineage model.** `IframeMetadata` has no `parentFrameId` field, so the agent cannot reconstruct the frame tree. Nested iframes (`main → content → result`) appear as a flat list with no parent-child relationship.
2. **Empty iframe list.** On real-world pages, `iframes: []` was returned because the content script context landed in an ad/tracking frame (e.g., `rtb.gumgum.com`) instead of the main document. The agent had no way to filter or prioritize frames.

The v4 evaluation scored A4 at ❌ (0 pts) and C3 at ❌ (0 pts) for this gap.

### Constraints

- The Chrome extension content script runs in the main-world document context. Cross-origin iframe DOM is **not accessible** due to Same-Origin Policy.
- Chrome Manifest V3 `all_frames: true` allows content scripts to run **inside** each iframe, but each runs in its own isolated context — they cannot see each other's DOM.
- The current relay architecture sends actions to the content script and receives structured responses back. There is no CDP (Chrome DevTools Protocol) session to the browser — the extension uses `chrome.tabs` and `chrome.scripting` APIs only.
- The `IframeMetadata` type is already exported and consumed by agents. Changes must be backwards-compatible (additive only).

### Options Considered

| Option | Description | Trade-offs |
|--------|-------------|------------|
| **A. Content-script enumeration (additive fields)** | Enhance the existing content-script `document.querySelectorAll('iframe')` approach. Add `parentFrameId`, `title`, and classification fields to `IframeMetadata`. Each content script instance reports its own `frameId` (from `window.frameElement?.id` or a generated UUID) and its parent's `frameId`. | Simple, no new infrastructure. Limited to same-origin visibility for nested frames. Cross-origin frames get metadata from the `<iframe>` element in the parent, not from inside. |
| **B. CDP `Page.getFrameTree` via service worker** | Use `chrome.debugger.attach()` to get a CDP session, then call `Page.getFrameTree` for the authoritative frame tree. | Provides complete cross-origin frame tree. But: requires `debugger` permission (scary browser prompt), service worker complexity, and conflicts with DevTools being open. Heavy for this use case. |
| **C. Multi-frame content script aggregation** | With `all_frames: true`, each same-origin content script reports its depth and parent info. Aggregate in the service worker before returning to relay. | Medium complexity. Gets same-origin nested frames correctly. Cross-origin frames still only get outer metadata. |

### Decision

**Option A** — Content-script enumeration with additive fields and frame classification.

Rationale: Option A provides the most value with least disruption. The content script already enumerates iframes; we just need to enrich the metadata. Cross-origin frames will have `sameOrigin: false` and limited metadata (from the outer `<iframe>` element), which is the correct representation of what's actually accessible. Option B's debugger prompt is unacceptable for a general-purpose tool. Option C is planned for a future iteration if deeper nested-frame support is needed.

### Interface Changes

#### File: `packages/browser/src/page-tool-types.ts`

```typescript
/**
 * B2-VD-006 / A4: Metadata for a single <iframe> element in the page.
 * Emitted in the `iframes` array of `PageMapResponse` when `traverseFrames: true`.
 */
export interface IframeMetadata {
  /** Unique frame identifier (name, id, or auto-generated). */
  frameId: string;
  /** The iframe's `src` attribute (may be empty for srcdoc/about:blank). */
  src: string;
  /** Bounding box in parent viewport coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
  /**
   * Whether the iframe is same-origin as the parent document.
   * - `true`: child-frame DOM is accessible to content script with `all_frames: true`.
   * - `false`: child-frame DOM is opaque due to Same-Origin Policy.
   */
  sameOrigin: boolean;

  // ── A4: Frame lineage fields (new) ──────────────────────────────────────

  /**
   * A4: Frame ID of this iframe's parent frame.
   * - `null` for top-level iframes (parent is the main document).
   * - A `frameId` string for nested iframes.
   * This field enables tree reconstruction from the flat `iframes[]` array.
   */
  parentFrameId: string | null;

  /**
   * A4: The iframe's `title` attribute, if present.
   * Useful for accessibility and for agents to identify frame purpose.
   */
  title?: string;

  /**
   * A4: Nesting depth relative to the top document.
   * - `1` for direct children of the main document.
   * - `2` for iframes nested inside another iframe.
   * Agents can use this to prioritize shallow frames.
   */
  depth: number;

  /**
   * A4: Heuristic classification of the iframe's likely purpose.
   * Helps agents skip ad/tracker frames and focus on content frames.
   * - `"content"` — appears to contain meaningful page content.
   * - `"ad"` — matches known ad/tracker URL patterns.
   * - `"widget"` — social media embeds, reCAPTCHA, payment forms, etc.
   * - `"unknown"` — could not be classified.
   */
  classification: "content" | "ad" | "widget" | "unknown";

  /**
   * A4: Whether this iframe is visible in the viewport.
   * Iframes with `display: none`, zero dimensions, or off-screen position
   * are marked `false`. Agents can filter to visible-only frames.
   */
  visible: boolean;
}
```

#### File: `packages/browser/src/page-tool-types.ts` — `GetPageMapArgs`

```typescript
export interface GetPageMapArgs {
  // ... existing fields unchanged ...

  /**
   * A4: Filter returned iframes by classification.
   * When provided, only iframes matching one of the specified classifications
   * are included in the `iframes[]` array. Requires `traverseFrames: true`.
   * Example: `["content", "widget"]` to exclude ad frames.
   */
  frameFilter?: Array<"content" | "ad" | "widget" | "unknown">;
}
```

#### File: `packages/browser/src/page-tool-definitions.ts`

Add `frameFilter` parameter to the `get_page_map` tool schema:

```typescript
frameFilter: {
  type: "array",
  items: {
    type: "string",
    enum: ["content", "ad", "widget", "unknown"],
  },
  description: "A4: Filter iframes by classification. Only iframes matching one of the specified types are returned. Requires traverseFrames: true.",
},
```

### Implementation Notes

1. **Frame classification heuristic** — Create a utility function `classifyIframe(src: string): "content" | "ad" | "widget" | "unknown"` in a new file `packages/browser/src/frame-classifier.ts`. The classifier should:
   - Match against a curated list of ad/tracker domain patterns (e.g., `doubleclick.net`, `googlesyndication.com`, `gumgum.com`, `moatads.com`, `amazon-adsystem.com`).
   - Match widget patterns (e.g., `recaptcha`, `youtube.com/embed`, `twitter.com/widgets`, `platform.twitter.com`, `connect.facebook.net`).
   - Default to `"content"` for same-origin frames.
   - Default to `"unknown"` for unclassified cross-origin frames.
   - The pattern list should be a `readonly` array constant, not a config file, to keep deployment simple.

2. **`parentFrameId` determination** — In the content script's iframe enumeration logic, the parent frame ID is the frame the content script is currently running in. For top-level enumeration, `parentFrameId` is `null`. If we later enable multi-frame aggregation (Option C), nested scripts will report their own parent.

3. **`depth` calculation** — Currently always `1` since we only enumerate from the top document. When multi-frame aggregation is added, each content script will know its own depth via `window.parent === window` checks.

4. **`visible` calculation** — Use the iframe element's `getBoundingClientRect()` and `getComputedStyle()` in the content script. An iframe is `visible: false` if: `display === 'none'`, `visibility === 'hidden'`, width or height is 0, or the element is entirely outside the viewport.

5. **Backward compatibility** — The new fields (`parentFrameId`, `title`, `depth`, `classification`, `visible`) are always populated when `traverseFrames: true`. Old consumers that don't read them are unaffected. The `frameFilter` parameter is optional and defaults to "return all".

6. **Files to change:**
   - `packages/browser/src/page-tool-types.ts` — `IframeMetadata`, `GetPageMapArgs`
   - `packages/browser/src/page-tool-definitions.ts` — `get_page_map` schema
   - `packages/browser/src/page-tool-handlers-impl.ts` — `handleGetPageMap` to apply `frameFilter`
   - `packages/browser/src/frame-classifier.ts` — new file, pure function
   - Chrome extension content script (wherever iframe enumeration happens) — add new fields to the returned metadata

---

## ADR-2: Screenshot Artifact Transport (G6)

### Problem Statement

`capture_region` always returns screenshot data as an inline base64 data URL in the `dataUrl` field. For large screenshots (full-page captures can exceed 1MB base64), this:

1. **Bloats the MCP response.** Large base64 strings consume agent context window tokens.
2. **Prevents efficient caching.** The same screenshot cannot be referenced by ID later.
3. **No indirection.** The `artifactMode` field already declares `"file-ref" | "remote-ref"` in the type, but only `"inline"` is ever set.

The v4 evaluation scored G6 at ❌ (0 pts) because the default artifact transport is always inline with no opt-in file-based alternative.

### Constraints

- The `CaptureRegionResponse` type already has `artifactMode?: "inline" | "file-ref" | "remote-ref"` — we can use the existing union.
- The `~/.accordo/` directory already exists and is used for audit logs (architecture.md §3.2).
- The `auditId` is already generated per capture invocation as a UUIDv4 — it's a natural basis for unique filenames.
- The response must remain JSON-serializable (no binary in the MCP response body).
- `"remote-ref"` is out of scope — no cloud storage dependency in the first iteration.
- Backward compatibility: agents that don't specify a transport mode must continue to receive inline data URLs.

### Options Considered

| Option | Description | Trade-offs |
|--------|-------------|------------|
| **A. Agent-specified `transport` param** | Add a `transport` field to `CaptureRegionArgs`. When `"file-ref"`, write the decoded image to `~/.accordo/screenshots/<auditId>.<format>` and return a `fileUri` instead of `dataUrl`. Default to `"inline"` for backward compatibility. | Clean opt-in. Agent decides. Simple implementation. File cleanup is the agent's or user's responsibility. |
| **B. Size-based auto-promotion** | Automatically switch to `file-ref` when the base64 exceeds a threshold (e.g., 256KB). Always write the file; return `dataUrl` only below the threshold. | Invisible to agents — just works. But: agents may not expect the format change, and threshold tuning is tricky. |
| **C. Both `dataUrl` and `fileUri` always** | Always write the file, always include both fields. Agent reads whichever it prefers. | Wastes disk on small captures. Simple agent-side logic. |

### Decision

**Option A** — Agent-specified `transport` parameter, defaulting to `"inline"`.

Rationale: Explicit agent control is cleaner for MCP tool semantics. The agent knows its context-window constraints and can opt into `"file-ref"` when capturing full pages. Option B breaks the principle of least surprise. Option C wastes disk and complicates cleanup.

### Interface Changes

#### File: `packages/browser/src/page-tool-types.ts` — `CaptureRegionArgs`

```typescript
export interface CaptureRegionArgs {
  // ... existing fields unchanged ...

  /**
   * G6: Artifact transport mode for the captured screenshot.
   * - `"inline"` (default) — base64 data URL in `dataUrl` field.
   * - `"file-ref"` — image written to disk; `fileUri` returned instead of `dataUrl`.
   *
   * When `"file-ref"`, the screenshot is saved to:
   *   `~/.accordo/screenshots/<auditId>.<format>`
   * and the response contains `fileUri` (absolute file:// URI) and `filePath`
   * (absolute OS path) instead of `dataUrl`.
   *
   * Default: `"inline"` for backward compatibility.
   */
  transport?: "inline" | "file-ref";
}
```

#### File: `packages/browser/src/page-tool-types.ts` — `CaptureRegionResponse`

```typescript
export interface CaptureRegionResponse extends SnapshotEnvelopeFields {
  // ... existing fields unchanged ...

  /**
   * G6: Absolute file:// URI to the saved screenshot.
   * Present only when `transport: "file-ref"` was requested and capture succeeded.
   * Example: `"file:///home/user/.accordo/screenshots/a1b2c3d4-...-e5f6.png"`
   */
  fileUri?: string;

  /**
   * G6: Absolute OS file path to the saved screenshot.
   * Present only when `transport: "file-ref"` was requested and capture succeeded.
   * Convenience field — same location as `fileUri` but without the `file://` prefix.
   * Example: `"/home/user/.accordo/screenshots/a1b2c3d4-...-e5f6.png"`
   */
  filePath?: string;
}
```

#### File: `packages/browser/src/page-tool-definitions.ts`

Add `transport` parameter to the `capture_region` tool schema:

```typescript
transport: {
  type: "string",
  enum: ["inline", "file-ref"],
  description: "G6: Artifact transport mode. 'inline' (default): base64 data URL in dataUrl. 'file-ref': screenshot saved to disk, fileUri/filePath returned instead.",
},
```

### Implementation Notes

1. **Screenshot directory** — `~/.accordo/screenshots/`. Create on first use with `fs.mkdirSync(dir, { recursive: true })`. This follows the existing `~/.accordo/` convention from audit logs.

2. **File naming** — `<auditId>.<format>` where `auditId` is the existing UUIDv4 generated per capture and `format` is `"jpeg"`, `"png"`, or `"webp"` (see ADR-3). Example: `a1b2c3d4-5678-9abc-def0-123456789abc.png`.

3. **Write flow in `handleCaptureRegion`:**
   ```
   if transport === "file-ref":
     1. Decode base64 from dataUrl (strip the `data:image/...;base64,` prefix)
     2. Write Buffer to ~/.accordo/screenshots/<auditId>.<format>
     3. Set response.fileUri = pathToFileURL(filePath).href
     4. Set response.filePath = absolutePath
     5. Delete response.dataUrl (do not return inline data)
     6. Set response.artifactMode = "file-ref"
   else:
     (existing behavior — set artifactMode = "inline")
   ```

4. **Error handling** — If the file write fails (disk full, permission error), fall back to `"inline"` and set `artifactMode = "inline"`. Add a `transportFallback?: boolean` field to the response so the agent knows the fallback occurred.

5. **File cleanup** — Screenshots persist until explicitly deleted. Future work may add a `manage_screenshots` tool or TTL-based cleanup. For now, users can manually clear `~/.accordo/screenshots/`.

6. **Files to change:**
   - `packages/browser/src/page-tool-types.ts` — `CaptureRegionArgs`, `CaptureRegionResponse`
   - `packages/browser/src/page-tool-definitions.ts` — `capture_region` schema
   - `packages/browser/src/page-tool-handlers-impl.ts` — `handleCaptureRegion` (add file-write branch)

---

## ADR-3: WebP Screenshot Format (E4)

### Problem Statement

`capture_region` supports `"jpeg"` and `"png"` output formats but not `"webp"`. WebP typically produces 25–35% smaller files than JPEG at equivalent quality, reducing both MCP response size (inline mode) and disk usage (file-ref mode).

The v4 evaluation scored E4 at 🟡 (0.5 pts) — PNG/JPEG supported, but format breadth is limited.

### Constraints

- Chrome's CDP `Page.captureScreenshot` natively supports `format: "webp"` with a `quality` parameter (0–100). No additional dependencies needed on the browser side.
- The Hub and Bridge do not interpret image data — they pass base64 through. No changes needed there.
- Some image viewers and tools do not support WebP. The agent should be aware this is a lossy format by default.

### Decision

Add `"webp"` to the `format` union in `CaptureRegionArgs` and the tool schema. No architectural changes — this is a schema extension.

### Interface Changes

#### File: `packages/browser/src/page-tool-types.ts` — `CaptureRegionArgs`

```typescript
  /** GAP-E1 / E4: Output format for the captured image — "jpeg" (default), "png", or "webp". */
  format?: "jpeg" | "png" | "webp";
```

#### File: `packages/browser/src/page-tool-definitions.ts`

```typescript
format: {
  type: "string",
  enum: ["jpeg", "png", "webp"],
  description: "GAP-E1 / MCP-VC-004 / E4: Output image format — 'jpeg' (default), 'png', or 'webp'",
},
```

### Implementation Notes

1. **Chrome extension change** — In the CDP `Page.captureScreenshot` call (or `chrome.tabs.captureVisibleTab` depending on the capture path), pass `format: "webp"` when the agent specifies it. The `quality` parameter works the same as for JPEG (1–100).

2. **MIME type handling** — The base64 data URL prefix changes from `data:image/jpeg;base64,...` to `data:image/webp;base64,...`. If the extension constructs this prefix, it must handle the `"webp"` case.

3. **File extension for file-ref mode (ADR-2)** — When `transport: "file-ref"` and `format: "webp"`, the filename is `<auditId>.webp`.

4. **No default change** — Default format remains `"jpeg"`. Agents opt into WebP explicitly.

5. **Files to change:**
   - `packages/browser/src/page-tool-types.ts` — `CaptureRegionArgs.format` union
   - `packages/browser/src/page-tool-definitions.ts` — `capture_region` schema `format` enum
   - Chrome extension screenshot capture logic — pass `"webp"` to CDP/chrome.tabs API

---

## Cross-Cutting Considerations

### Requirement traceability

| v4 Item | ADR | Key interface change | Expected score after implementation |
|---------|-----|---------------------|-------------------------------------|
| A4 (❌ 0pts) | ADR-1 | `IframeMetadata.parentFrameId`, `.depth`, `.classification`, `.visible` + `GetPageMapArgs.frameFilter` | ✅ (1pt) |
| C3 (❌ 0pts) | ADR-1 | Same — frame tree reconstructable from `parentFrameId` | ✅ (1pt) |
| G6 (❌ 0pts) | ADR-2 | `CaptureRegionArgs.transport` + `CaptureRegionResponse.fileUri/.filePath` | ✅ (1pt) |
| E4 (🟡 0.5pts) | ADR-3 | `CaptureRegionArgs.format` adds `"webp"` | ✅ (1pt) |

**Projected score improvement:** 37/45 → 39.5/45 (+2.5 pts from 4 items).

### Implementation order

1. **ADR-3 (WebP)** first — smallest change, no new files, immediate value.
2. **ADR-2 (file-ref transport)** second — contained to handler logic and one new directory.
3. **ADR-1 (iframe lineage)** third — largest scope, new file, content script changes.

### Backward compatibility

All three ADRs are strictly additive:
- New optional fields on existing interfaces.
- New optional parameters with backward-compatible defaults.
- No existing behavior changes unless the agent explicitly opts in.
