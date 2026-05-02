# Comments SDK visual centralization review

## Executive summary

- **There is one shared visual renderer for web-style surfaces:** `@accordo/comment-sdk` owns the canonical DOM pin, popover, inline-input, and shared CSS for **Markdown preview, Marp slides, browser page overlays, and diagram overlays**.
- **But visual behavior is not fully centralized across all modalities:** editor/text comments use the **VS Code native Comments API**, the comments panel uses its own **TreeView visuals**, and some surfaces add **local rendering/visibility rules** on top of the SDK.
- **Root cause of the reported diagram bug:** the global comment type system accepts generic surface coordinates for `surfaceType: "diagram"`, but the diagram renderer only turns `coordinates.type === "diagram-node"` into visible pins.
- **Single-change editability rating:** **4 / 5**
  - 1 = fully centralized
  - 5 = fully fragmented

## Verdict

### Is there one canonical place where all comment visuals are defined?

**No.**

There is a **partial center of gravity** in `packages/comment-sdk/`, but it only covers the DOM/webview-style surfaces.

### What is centralized today

`packages/comment-sdk/` is the canonical renderer for:

- pin DOM shape and badge count
- pin state classes (`open`, `updated`, `resolved`)
- shared pin/popover CSS
- popover DOM
- block highlight / gutter marker CSS

### What is still scattered

- **Editor/text surface:** native VS Code `CommentController` + `CommentThread` widgets (`packages/comments/src/native-comment-controller.ts`, `native-comment-sync.ts`)
- **Comments panel:** separate TreeView icons/emoji/labels (`packages/comments/src/panel/comments-tree-provider.ts`)
- **Diagram:** extra pin-size scaling and a custom inline input overlay (`packages/diagram/src/webview/comment-overlay.ts`)
- **Browser:** merged/overridden content CSS plus legacy unused pin/popover renderers still present in source (`packages/browser-extension/src/content/content-styles.css`, `content-pins.ts`, `content-input-popover.ts`, `content-input-form.ts`)
- **Visibility logic:** each surface decides independently which anchors become renderable `blockId`s

## Root-cause finding for the diagram normalized-coordinate bug

The failure mode is architectural, not just cosmetic:

1. The shared type system allows generic surface coordinates for diagrams:
   - `packages/bridge-types/src/comment-types.ts:79-85`
2. The tool-side anchor builder only validates **slide** coordinates; diagrams get no shape check:
   - `packages/comments/src/comment-tools/anchor.ts:46-55`
3. The diagram bridge creates only `diagram-node` anchors for UI-created comments:
   - `packages/diagram/src/comments/diagram-comments-bridge.ts:115-121`
4. The diagram overlay renderer filters incoming threads and only renders ones whose coordinates contain a string `nodeId`:
   - `packages/diagram/src/webview/comment-overlay.ts:63-69`

So `{"type":"diagram","x":0.3,"y":0.5}` can be **stored** but is later **filtered out** by the diagram webview, producing “accepted but invisible”.

## Active visual rendering locations

### 1) Shared SDK core (active, canonical for webview/browser surfaces)

| File | Lines | Role |
|---|---:|---|
| `packages/comment-sdk/src/pin-renderer.ts` | 22-57 | Computes pin state and creates the pin DOM element/badge |
| `packages/comment-sdk/src/pin-renderer.ts` | 66-149 | Repositions pins on scroll/resize |
| `packages/comment-sdk/src/thread-manager.ts` | 60-91 | Loads pins, appends them to layer, adds block markers |
| `packages/comment-sdk/src/thread-manager.ts` | 98-115 | Adds a single pin |
| `packages/comment-sdk/src/thread-manager.ts` | 122-135 | Updates pin visual state/badge |
| `packages/comment-sdk/src/popover-renderer.ts` | 31-211 | Builds and positions the comment popover DOM |
| `packages/comment-sdk/src/sdk.ts` | 75-113 | Creates overlay layer and wires SDK lifecycle |
| `packages/comment-sdk/src/sdk.ts` | 140-190 | Public load/add/update/remove/reposition entry points |
| `packages/comment-sdk/src/sdk.css` | 22-89 | Base pin shape, colors, hover, badge |
| `packages/comment-sdk/src/sdk.css` | 93-177 | Inline input/button visuals |
| `packages/comment-sdk/src/sdk.css` | 178-348 | Popover, avatars, resolved banner, block highlight, gutter marker |

### 2) Editor/text surface (active, **not** using comment-sdk)

| File | Lines | Role |
|---|---:|---|
| `packages/comments/src/native-comment-controller.ts` | 68-85 | Creates the VS Code `CommentController`; editor gutter/comment affordance comes from native API |
| `packages/comments/src/native-comment-controller.ts` | 316-330 | Builds individual VS Code comment objects, including author icons/labels |
| `packages/comments/src/native-comment-controller.ts` | 333-378 | Creates native `CommentThread` widgets and sets labels/state/collapse behavior |
| `packages/comments/src/native-comment-sync.ts` | 232-247 | Updates native widget visuals after reply/resolve/reopen |
| `packages/comments/src/native-comment-sync.ts` | 270-274 | Marks stale widgets visually |

### 3) Comments panel / thread list (active, separate visual system)

| File | Lines | Role |
|---|---:|---|
| `packages/comments/src/panel/comments-tree-provider.ts` | 47-54 | Intent emoji mapping |
| `packages/comments/src/panel/comments-tree-provider.ts` | 94-125 | Human-readable anchor labels |
| `packages/comments/src/panel/comments-tree-provider.ts` | 131-149 | File/surface icon mapping |
| `packages/comments/src/panel/comments-tree-provider.ts` | 285-297 | Open/resolved group header visuals |
| `packages/comments/src/panel/comments-tree-provider.ts` | 312-368 | Thread/comment tree item label, icon, status badge, description, tooltip |

### 4) Markdown preview surface (active, uses comment-sdk)

| File | Lines | Role |
|---|---:|---|
| `packages/md-viewer/src/webview-template.ts` | 108-109, 117-118 | Injects shared SDK CSS/JS into the preview |
| `packages/md-viewer/src/webview-template.ts` | 125-132 | Surface-specific `coordinateToScreen()` for pin placement in preview gutter |
| `packages/md-viewer/src/webview-template.ts` | 196-216 | Initializes the shared SDK |
| `packages/md-viewer/src/webview-template.ts` | 225-242 | Handles load/update/remove/focus for rendered pins/popovers |
| `packages/md-viewer/src/preview-bridge.ts` | 67-96 | Converts store threads into `SdkThread`; determines whether a thread gets a renderable `blockId` |
| `packages/md-viewer/src/commentable-preview.ts` | 276-285 | Wires the SDK assets into the actual webview HTML |

### 5) Marp slide surface (active, uses comment-sdk)

| File | Lines | Role |
|---|---:|---|
| `packages/marp/src/presentation-provider.ts` | 126-133 | Injects shared SDK CSS/JS into the Marp webview |
| `packages/marp/src/marp-webview-script-sdk-init.ts` | 27-34 | Filters pins to the current slide via `refreshPins()` |
| `packages/marp/src/marp-webview-script-sdk-init.ts` | 40-50 | Surface-specific `coordinateToScreen()` for normalized slide coordinates |
| `packages/marp/src/marp-webview-script-sdk-init.ts` | 57-73 | Wires SDK callbacks |
| `packages/marp/src/marp-webview-script-sdk-init.ts` | 95-103 | Initializes the shared SDK |
| `packages/marp/src/marp-webview-script-runtime.ts` | 31-45 | Refreshes visible pins when slide changes |
| `packages/marp/src/marp-webview-script-host.ts` | 18-57 | Refreshes/rebuilds pins after deck updates |
| `packages/marp/src/presentation-comments-bridge.ts` | 34-59 | Converts store threads into `SdkThread`; empty `blockId` means no pin |
| `packages/marp/src/presentation-comments-bridge.ts` | 171-179 | Rebuilds slide anchors from SDK block IDs |

### 6) Diagram surface (active, uses comment-sdk **plus local visual code**)

| File | Lines | Role |
|---|---:|---|
| `packages/diagram/src/webview/comment-overlay.ts` | 63-88 | Converts raw threads to `SdkThread`; only diagram-node anchors become visible pins |
| `packages/diagram/src/webview/comment-overlay.ts` | 118-127 | Local `.accordo-pin` size/font override based on diagram zoom |
| `packages/diagram/src/webview/comment-overlay.ts` | 136-250 | Custom diagram-only inline comment input overlay with local styling |
| `packages/diagram/src/webview/comment-overlay.ts` | 288-336 | Initializes shared SDK with diagram coordinate mapping |
| `packages/diagram/src/webview/comment-overlay.ts` | 339-377 | Diagram-specific Alt+click hit-testing and overlay launch |
| `packages/diagram/src/webview/comment-overlay.ts` | 401-426 | Loads/repositions pins on scene/zoom changes |
| `packages/diagram/src/comments/diagram-comments-bridge.ts` | 115-121 | Hard-codes UI-created diagram anchors to `diagram-node` |

### 7) Browser page surface (active, uses comment-sdk **plus browser-specific CSS/wiring**)

| File | Lines | Role |
|---|---:|---|
| `packages/browser-extension/src/content/comment-ui-runtime.ts` | 30-37 | Converts browser threads into `SdkThread` |
| `packages/browser-extension/src/content/comment-ui-runtime.ts` | 40-45 | Browser-specific `coordinateToScreen()` with fallback stack placement |
| `packages/browser-extension/src/content/comment-ui-runtime.ts` | 58-78 | Initializes the shared SDK in page context |
| `packages/browser-extension/src/content/comment-ui-runtime.ts` | 82-94 | Loads pins into the SDK |
| `packages/browser-extension/scripts/build.ts` | 52-59 | Merges shared `sdk.css` with browser extension CSS |
| `packages/browser-extension/src/content/content-styles.css` | 28-49 | Browser overrides for pin/popover stacking/hover |
| `packages/browser-extension/src/content/content-styles.css` | 121-209 | Browser-local form/reply styling |

## Inactive / legacy visual code still in the tree

These files still render comment visuals directly, but they do **not** appear to be wired into the current `content-entry.ts` bootstrap path.

| File | Lines | Why it matters |
|---|---:|---|
| `packages/browser-extension/src/content-pins.ts` | 14-71 | Legacy standalone pin renderer with its **own** pin shape/color/size |
| `packages/browser-extension/src/content-pins.ts` | 77-152 | Legacy pin removal/reposition/off-screen badge logic |
| `packages/browser-extension/src/content-input-popover.ts` | 8-134 | Legacy standalone thread popover with hard-coded inline styles |
| `packages/browser-extension/src/content-input-form.ts` | 35-113 | Legacy standalone comment form renderer |

This dead-path rendering code increases confusion and future blast radius even if it is not currently active.

## Centralization assessment

### What is good

- `@accordo/comment-sdk` is a real shared renderer, not just a type package.
- Markdown preview, Marp, diagram, and browser all route through the same core pin/popover DOM/CSS primitives.
- Shared CSS tokens and DOM class names are mostly concentrated in one place.

### What breaks true single-source rendering

1. **Editor/text cannot share the renderer** because it uses native VS Code comments.
2. **Comments panel is separate UI** with its own icons, emoji, labels, and grouping visuals.
3. **Diagram adds local visual rules**:
   - custom inline input overlay
   - zoom-dependent pin size override
   - diagram-node-only visibility filter
4. **Browser adds local CSS and retains legacy renderers**, so it is not cleanly SDK-only.
5. **Visibility is not centralized**:
   - Markdown preview decides block IDs differently than Marp
   - Marp decides active-slide visibility in its own script
   - Diagram decides renderability by `nodeId`
   - Browser decides anchor resolution and fallback placement locally

## Blast radius of common visual changes

### A) Change pin color/state colors (web surfaces only)

**Likely edit set:**

1. `packages/comment-sdk/src/sdk.css` (`.accordo-pin--open`, `--updated`, `--resolved`)
2. Possibly `packages/browser-extension/src/content/content-styles.css` if browser-specific overrides should stay aligned

**Approximate active files:** **1-2**

### B) Change pin size globally

**Likely edit set:**

1. `packages/comment-sdk/src/sdk.css` (`.accordo-pin`, badge font)
2. `packages/diagram/src/webview/comment-overlay.ts` (`_updatePinSizeCss`, currently hard-coded from 22/11)
3. Potentially browser fallback spacing in `packages/browser-extension/src/content/comment-ui-runtime.ts:43-45`

**Approximate active files:** **2-3**

### C) Change whether a comment is visible/renderable on a surface

**Likely edit set varies by surface**, because visibility rules are scattered:

- Markdown preview: `packages/md-viewer/src/preview-bridge.ts`
- Marp: `packages/marp/src/presentation-comments-bridge.ts`, `marp-webview-script-sdk-init.ts`
- Diagram: `packages/diagram/src/comments/diagram-comments-bridge.ts`, `webview/comment-overlay.ts`
- Browser: `packages/browser-extension/src/content/comment-ui-runtime.ts`, `content/anchor-position.ts`
- Shared input contract: `packages/comments/src/comment-tools/anchor.ts`, `packages/bridge-types/src/comment-types.ts`

**Approximate active files:** **5-8**

### D) Change “all comment visuals across the whole product”

At minimum you would touch:

1. `packages/comment-sdk/src/sdk.css`
2. `packages/comments/src/native-comment-controller.ts`
3. `packages/comments/src/native-comment-sync.ts`
4. `packages/comments/src/panel/comments-tree-provider.ts`
5. `packages/diagram/src/webview/comment-overlay.ts`
6. `packages/browser-extension/src/content/content-styles.css`

**Approximate active files:** **6+**

## Rating: single-change editability

**Score: 4 / 5**

Reasoning:

- **Not a 5:** there is meaningful centralization in `@accordo/comment-sdk`.
- **Not a 3:** too much important behavior still lives outside the SDK, especially visibility rules and non-webview modalities.
- **A 4 fits:** one change to comment visuals across all modalities is still multi-file and modality-aware.

## Recommended refactors

### 1) Make surface renderability explicit in the type/validation layer

**Problem:** diagram accepts anchors the renderer cannot display.

**Refactor:**

- Introduce **surface-specific coordinate validation** in `packages/comments/src/comment-tools/anchor.ts`
- For `surfaceType: "diagram"`, require `coordinates.type === "diagram-node"` unless/until normalized diagram anchors are truly supported
- Mirror that contract in `packages/bridge-types/src/comment-types.ts` docs/comments and tests

### 2) Move “can this anchor render?” logic into comment-sdk-facing adapters, not ad hoc per surface

Today each surface invents its own `toSdkThread()` rules.

**Refactor:** define a shared adapter contract like:

- `toRenderableSdkThread(thread): SdkThread | null`
- `surfaceCanRender(anchor): boolean`

Then each surface still supplies geometry, but the null/visible contract becomes explicit and testable.

### 3) Pull diagram-only visual overrides behind SDK extension points

**Problem:** diagram directly overrides `.accordo-pin` size and ships a custom inline input overlay.

**Refactor:** add SDK options for:

- `pinScale` or `pinStyleResolver`
- optional custom `renderInlineInput()` hook

That keeps the DOM/CSS contract centralized while still allowing diagram zoom behavior.

### 4) Remove or quarantine browser legacy renderers

**Problem:** `content-pins.ts`, `content-input-popover.ts`, and `content-input-form.ts` preserve a second visual implementation in source.

**Refactor:**

- delete them if unused, or
- move them into a clearly marked `legacy/` folder with a README stating they are inactive

### 5) Define a visual token layer above raw CSS selectors

Create a small shared visual-token module for things like:

- pin base size
- pin state colors
- popover width/radius
- z-index tiers

Then:

- `sdk.css` consumes the tokens
- diagram zoom code scales from the same base token
- browser-specific CSS references the same named values

### 6) Accept that editor/text remains a separate renderer, but isolate its styling contract

The VS Code native renderer will never fully share DOM/CSS with webview surfaces.

Still, you can centralize the **semantic visual mapping** by extracting shared helpers for:

- status → label/icon text
- intent → emoji/label
- resolved/open wording

Those helpers are currently split between:

- `packages/comments/src/native-comment-controller.ts`
- `packages/comments/src/native-comment-sync.ts`
- `packages/comments/src/panel/comments-tree-provider.ts`

## Bottom line

Accordo has a **shared comment renderer**, but not a **fully centralized comment visual architecture**.

The webview/browser surfaces mostly converge on `@accordo/comment-sdk`, yet the final user-visible result is still shaped by surface-local code for:

- anchor-to-block mapping
- visibility filtering
- zoom/layout adaptation
- native VS Code widget rendering
- panel/tree rendering

That is why a diagram anchor can be accepted by the backend contract and still disappear at render time.
