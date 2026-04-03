# Accordo IDE — Architecture Decision Record

**Purpose:** Non-obvious design choices logged during Phase A design sessions.  
**Format:** ADR-lite (DEC-NNN: date, module, context, decision, alternatives, consequences).

---

## DEC-001 — Narration plugin: client-side plugin vs system prompt injection

**Date:** 2026-03-31  
**Module:** narration-plugin (OpenCode)

**Context:** ADR-03 in voice-architecture.md specifies agent-driven summary narration via system prompt injection. The Hub's prompt engine adds a directive telling the agent to call `readAloud` after each response. This works well for agents that consume the Hub's `/instructions` endpoint (Copilot, Claude Code). However, OpenCode lacks a reliable hook to inject into the system prompt — `chat.system.transform` is broken, and no `before-prompt` hook exists.

**Decision:** Build an OpenCode plugin that hooks `session.idle`, summarizes the agent response via an external LLM (Gemini Flash), and calls `readAloud` via the Hub's MCP endpoint. This is a **complementary approach** to ADR-03, not a replacement.

**Alternatives considered:**
1. *Fix OpenCode's system prompt injection* — blocked on upstream (OpenCode issue tracker)
2. *Agent-native summary* — requires modifying each agent's prompt, not portable
3. *Hub-side response interception* — Hub doesn't see agent responses (only tool calls)

**Consequences:**
- (+) Works today without upstream changes
- (+) Zero changes to Hub, Bridge, or voice extension
- (-) Requires a Gemini API key for summarization mode
- (-) Adds ~1s latency for the summarization LLM call
- (-) Duplicates ~2KB of response text to the summarization LLM

---

## DEC-002 — Narration plugin: Gemini 2.0 Flash for summarization

**Date:** 2026-03-31  
**Module:** narration-plugin (OpenCode)

**Context:** The plugin needs a fast, cheap LLM to summarize agent responses into 2-3 spoken sentences. The summarization prompt is simple (fixed system prompt + response text → summary).

**Decision:** Use Google Gemini 2.0 Flash via the generativelanguage.googleapis.com REST API.

**Alternatives considered:**
1. *GPT-4o-mini* ($0.15/$0.60 per 1M) — 50% more expensive, slightly slower
2. *Claude 3.5 Haiku* ($0.25/$1.25 per 1M) — 2.5x more expensive
3. *Local model (Ollama/llama.cpp)* — zero cost but requires local GPU, adds setup complexity
4. *No summarization (agent summarizes itself)* — not possible without system prompt injection

**Consequences:**
- (+) Cheapest cloud option ($0.10/$0.40 per 1M tokens ≈ $0.01/day at 100 responses)
- (+) Fast (~500ms for short prompts)
- (+) Simple API key auth (no OAuth)
- (+) Raw `fetch` — no SDK dependency
- (-) Requires Google AI API key
- (-) Cloud dependency (fails offline — graceful skip per NP-07)

---

## DEC-003 — Narration plugin: project-scoped, not global

**Date:** 2026-03-31  
**Module:** narration-plugin (OpenCode)

**Context:** OpenCode plugins can be placed in `.opencode/plugins/` (project-scoped) or `~/.config/opencode/plugins/` (global).

**Decision:** Project-scoped (`.opencode/plugins/`).

**Rationale:** The Hub URL and bearer token in `opencode.json` are project-specific (the token is regenerated per Bridge activation). A global plugin would need to dynamically discover which project's MCP config to use — unnecessary complexity.

**Consequences:**
- (+) Plugin reads `opencode.json` from the project root — simple, always correct
- (-) Must be copied to each project that wants narration (or symlinked)

---

## DEC-004 — Narration plugin: 1500ms debounce for subagent filtering

**Date:** 2026-03-31  
**Module:** narration-plugin (OpenCode)

**Context:** OpenCode's `session.idle` event fires after every agent response, including intermediate subagent completions. Narrating each subagent response would be noisy and wasteful.

**Decision:** Debounce `session.idle` by 1500ms. If another idle event arrives within the window, the previous is cancelled. Only the final idle triggers narration.

**Rationale:** The `roampal` OpenCode plugin uses the same 1500ms debounce pattern for the same reason. This is an established community pattern.

**Consequences:**
- (+) Avoids narrating subagent intermediate responses
- (-) Adds 1.5s delay before narration starts (acceptable — user is reading the text response)

---

## DEC-005 — Hub-native tool local handler pattern

**Date:** 2026-04-01  
**Module:** hub (tool-registry, mcp-call-executor)

**Context:** The script runner migration (M52) moves the 4 script MCP tools from the VS Code extension host into the Hub process. These tools don't need Bridge routing — they execute entirely in the Hub. However, the McpCallExecutor currently routes all tool calls through `bridgeServer.invoke()`, which sends a WebSocket message to the Bridge, which dispatches to an extension handler, and returns the result. For Hub-native tools, this round-trip is unnecessary latency and creates a circular dependency (Hub → Bridge → Hub's own logic).

**Decision:** Add a `localHandler` field to a Hub-internal type `HubToolRegistration` (extends `ToolRegistration`). McpCallExecutor checks `isHubTool(tool)` before calling `bridgeServer.invoke()` — if the tool has a `localHandler`, call it directly. The `localHandler` field NEVER crosses the package boundary (architecture.md §4.5: handlers never on the wire).

**Alternatives considered:**
1. *Separate MCP endpoint for script tools* — over-engineering; script tools should be indistinguishable from other tools in `tools/list`
2. *Bridge-routed with self-invoke* — Hub sends WS to Bridge, Bridge calls back to Hub. Circular, fragile, adds latency for no benefit
3. *Modify ToolRegistration in bridge-types* — violates architecture.md §4.5 (handler functions never cross package boundary)

**Consequences:**
- (+) Zero additional latency for Hub-native tools (no WS round-trip)
- (+) Script tools appear in `tools/list` identically to Bridge tools — agents can't tell the difference
- (+) Hub-internal type — no wire format changes, no bridge-types changes
- (+) Audit logging and soft-error detection still apply (same code path after the short-circuit)
- (-) Two code paths in McpCallExecutor (local vs bridge) — must test both

---

## DEC-006 — ToolRegistry dual-pool design (Hub + Bridge)

**Date:** 2026-04-01  
**Module:** hub (tool-registry)

**Context:** `ToolRegistry.register()` does `this.tools.clear()` then re-adds — it's a full replacement called when Bridge sends a registry update. If Hub-native tools are stored in the same map, they get wiped on every Bridge registry update.

**Decision:** Split the internal storage into two maps: `bridgeTools` (cleared and replaced on Bridge updates) and `hubTools` (persisted forever, set once at startup via `registerHubTool()`). `list()`, `get()`, and `toMcpTools()` merge both pools. Hub tools take precedence on name collision (defensive — names shouldn't collide in practice).

**Alternatives considered:**
1. *Re-register Hub tools after every Bridge update* — fragile, order-dependent, easy to forget
2. *Make register() additive instead of replacing* — breaks the "full snapshot" contract that Bridge depends on
3. *Prefix-based filtering in register()* — `register()` would skip tools starting with "accordo_script_" — too magical, coupling on naming conventions

**Consequences:**
- (+) Bridge updates are still full-replacement — no contract change for the Bridge
- (+) Hub-native tools are registered once and never lost
- (+) `size` property accounts for deduplication
- (-) Slightly more complex `list()` and `size` — must merge two maps

---

## DEC-007 — Script deps adapter: throw-on-failure BridgeServer wrapping

**Date:** 2026-04-01  
**Module:** hub (script/script-deps-adapter)

**Context:** `ScriptRunnerDeps.executeCommand()` returns `Promise<unknown>` and throws on error. The ScriptRunner's `errPolicy` logic (abort vs skip) depends on this throw contract. `BridgeServer.invoke()` returns `ResultMessage { success, data?, error? }` — it does NOT throw on tool failure (only on connection/timeout errors). The adapter must bridge these two contracts.

**Decision:** The adapter wraps `bridgeServer.invoke()` results: if `!result.success`, throw `new Error(result.error ?? "Tool call failed")`. This preserves the ScriptRunner's throw-on-failure contract. Each ScriptRunnerDeps method maps to a specific Accordo tool:
- `executeCommand(cmd, args)` → `bridgeServer.invoke(cmd, args)` with throw-on-failure
- `speakText(text, opts)` → `bridgeServer.invoke("accordo_voice_readAloud", ...)`
- `showSubtitle(text, dur)` → `bridgeServer.invoke("accordo_subtitle_show", ...)` (fire-and-forget)
- `openAndHighlight(file, start, end)` → `bridgeServer.invoke("accordo_editor_highlight", ...)`
- `clearHighlights()` → `bridgeServer.invoke("accordo_editor_clearHighlights", ...)`
- `wait(ms)` → `setTimeout` (stays local in Hub — no Bridge call needed)

**Alternatives considered:**
1. *Modify ScriptRunner to handle ResultMessage directly* — breaks the clean dependency injection contract, couples runner to Hub internals
2. *Let adapter swallow errors and return undefined* — breaks errPolicy=abort behaviour

**Consequences:**
- (+) ScriptRunner code unchanged — zero modifications to the executor logic
- (+) Each dep method is a thin one-liner adapter — easy to test
- (-) `showSubtitle` is fire-and-forget (no result to check) — adapter must handle void return

---

## DEC-008 — Relay action type governance: `types.ts` as source of truth

**Date:** 2026-04-01  
**Module:** browser / browser-extension (relay layer)

**Context:** The relay action union exists in two files: `BrowserRelayAction` in `packages/browser/src/types.ts` (Hub-side) and `RelayAction` in `packages/browser-extension/src/relay-definitions.ts` (extension-side). These two unions drifted — `types.ts` includes `"get_comments_version"` while `relay-definitions.ts` does not. Adding the four new tab control actions (`"navigate"`, `"click"`, `"type"`, `"press_key"`) on top of this drift would cause TypeScript compile errors in Phase B.

**Decision:** `packages/browser/src/types.ts` is the **source of truth** for the relay action union. `relay-definitions.ts` must mirror it exactly. The same applies to error code unions on the response types. When a new action is added:
1. Add it to `BrowserRelayAction` in `types.ts` first.
2. Add the identical value to `RelayAction` in `relay-definitions.ts`.
3. Verify both unions have the same member count.

**Pre-existing fix:** Add `"get_comments_version"` to `RelayAction` in `relay-definitions.ts` to reconcile the drift before adding new actions.

**Alternatives considered:**
1. *Share a single union via a shared package* — would require a third shared types package between `browser` and `browser-extension`. Over-engineering for a string union. The extension is bundled by esbuild and cannot import from `@accordo/bridge-types` at runtime.
2. *Extension as source of truth* — illogical; the Hub-side defines the public API contract.
3. *Automated sync check* — a lint rule or CI check that compares both files. Good future investment but not needed for v1 — manual discipline is sufficient for 24 members.

**Consequences:**
- (+) Single source of truth eliminates type drift
- (+) Clear rule for developers: always edit `types.ts` first
- (-) Manual duplication required — two files must stay in sync
- (-) If a developer adds to one but not the other, TypeScript won't catch it (the types are in separate packages with no cross-import). A future CI check would close this gap.

---

## DEC-009 — MV3 service worker debugger recovery: catch-and-recover over storage-based tracking

**Date:** 2026-04-01  
**Module:** browser-extension (debugger-manager)

**Context:** MV3 service workers are terminated after ~30s idle. The `Set<number>` tracking attached debugger sessions is lost. But Chrome keeps the debugger attached at the browser level. On restart, `chrome.debugger.attach()` throws `"Another debugger is already attached to the tab"`.

Two recovery strategies were considered:
1. **Catch-and-recover:** Try `attach()`, if `"already attached"` error, add to Set and proceed.
2. **Storage-based tracking:** Use `chrome.storage.session` to persist the attached tab ID set across SW restarts.

**Decision:** Catch-and-recover (option 1).

**Rationale:** Chrome's actual debugger state is the single source of truth. Storage-based tracking creates a second source of truth that can drift — e.g., if the debugger is detached externally (another DevTools instance, user cancels the banner while SW is asleep). Catch-and-recover uses the error from Chrome itself to determine the actual state, so it's always correct.

**Note:** `control-permission.ts` correctly uses `chrome.storage.session` for permission state (ADR-TC-02) because permission is a user-facing concept that needs to survive SW restarts for UX continuity. Debugger attachment is a runtime implementation detail that Chrome itself tracks — our in-memory Set is just a cache.

**Consequences:**
- (+) Always correct — Chrome's error message is the source of truth
- (+) No storage reads on every `isAttached()` check (fast path stays synchronous)
- (+) Works even if storage becomes inconsistent
- (-) First control action after SW restart has one extra failed `attach()` attempt (~5ms overhead)
- (-) Depends on Chrome's error message string `"Another debugger is already attached"` — if Chrome changes the message, the recovery breaks. Mitigation: test against Chrome's actual message in integration tests.

---

## DEC-010 — capture_region: tab-swap strategy for non-active tab screenshots

**Date:** 2026-04-01  
**Module:** browser-extension (relay-capture-handler)

**Context:** `chrome.tabs.captureVisibleTab()` is the only Chrome extension API that captures a tab's visual content, but it can ONLY capture the currently active/visible tab. Multi-tab workflows (B2-CTX-001) require `capture_region` to target a specific tab by tabId, which may not be the active tab.

**Decision:** Use a tab-swap strategy: temporarily activate the target tab via `chrome.tabs.update(tabId, { active: true })`, capture, then restore the previous active tab. If the target tab is already active, skip the swap.

**Alternatives considered:**
1. *CDP `Page.captureScreenshot`* — Works on any debugger-attached tab without activation. However, capture_region is a read-only understanding tool; requiring debugger attachment is a permission escalation (the user would need to grant control permission just to take a screenshot). ❌
2. *Return error for non-active tabs* — Simple but defeats the purpose of multi-tab capture. ❌
3. *Require agent to call `select_page` first* — Works but creates poor UX; the agent visibly switches tabs which is disruptive. ❌
4. *Use `chrome.debugger` only for capture* — Same permission escalation issue as option 1. ❌

**Consequences:**
- (+) No new permissions or APIs required
- (+) capture_region remains a read-only tool (no debugger attachment)
- (+) Works across all Chrome versions with MV3
- (-) Brief visual flicker (~50–100ms) as tabs swap for non-active tab captures
- (-) Narrow race condition if user manually switches tabs during the capture window
- (-) Cross-window captures need `windowId` parameter for `captureVisibleTab` — must query tab info first

---

## DEC-011 — T-01 edgeStyles: deep-merge style fields, exclude waypoints

**Date:** 2026-04-03  
**Module:** diagram (accordo_diagram_patch)

**Context:** Adding `edgeStyles` argument to `accordo_diagram_patch` to allow per-edge visual customization. Two design decisions required: (1) how to merge style fields, and (2) whether to include `waypoints` in the schema.

**Decision 1 — Deep-merge style:** The handler must read `existing.style ?? {}` and produce `style: { ...existing.style, ...styleFields }` before calling `patchEdge`. This matches the pattern used by `nodeStyles` (ops.ts:306) and `clusterStyles` (ops.ts:331). `patchEdge` itself does a shallow spread on `EdgeLayout`, which would wipe the entire `style` object if we passed `{ style: styleFields }` directly.

**Decision 2 — Exclude waypoints:** `EdgeLayout.waypoints` exists in the type (types.ts:126) but is intentionally excluded from `edgeStyles`. Waypoint editing is a complex interaction (drag-to-create, multi-waypoint management) deferred to D-04. Including it prematurely would set wrong expectations.

**Consequences:**
- (+) Partial style updates work correctly — setting `strokeColor` doesn't wipe `strokeWidth`
- (+) Consistent with nodeStyles and clusterStyles patterns
- (+) DT-66 test explicitly guards against the shallow-merge trap
- (-) None — this is the only safe approach given `patchEdge`'s shallow spread

---

## DEC-012 — D-04: horizontal-first L-junctions in multi-waypoint orthogonal routing

**Date:** 2026-04-03  
**Module:** diagram (canvas/edge-router)

**Context:** When routing an orthogonal edge through N waypoints (N ≥ 2), each consecutive pair of control points that are not axis-aligned requires an L-junction (two segments: one horizontal, one vertical). The junction can be H-V (horizontal move first) or V-H (vertical move first).

**Decision:** Use horizontal-first (H-V) for all L-junctions.

**Rationale:** The existing 1-waypoint `routeOrthogonal` code (line 171) uses horizontal-first: `[bend.x, sy]` moves horizontally to the waypoint's x-coordinate before moving vertically. Using the same direction convention for multi-waypoint routing gives visual consistency regardless of waypoint count — a 1-waypoint path and a 2-waypoint path that share the first waypoint will have identical first two segments.

**Alternatives considered:**
1. *Alternating H-V / V-H* — more complex, produces rounder-looking staircases but harder to reason about and predict
2. *Vertical-first (V-H)* — valid but inconsistent with the existing 1-waypoint convention
3. *Axis-dominant per pair* — choose H or V based on which delta is larger. Non-deterministic when axes are equal; harder to predict visually.

**Consequences:**
- (+) Consistent with existing 1-waypoint behaviour
- (+) Simple, deterministic algorithm — same inputs always produce same output
- (+) Easy to explain to users: "each waypoint creates a horizontal step then a vertical step"
- (-) Some diagonal source→waypoint pairs may produce visually long horizontal segments before a short vertical one

---

## DEC-013 — Diagram parsers: runtime introspection over documentation

**Date:** 2026-04-03  
**Module:** `packages/diagram` (diag.2 — multi-type parsers)

**Context:** The Mermaid `diag.db` API is not formally documented — different diagram types expose their parsed data through inconsistent patterns (some use direct properties, others use getter methods). Architecture doc §6.3 initially contained speculative method-based signatures (e.g. `db.getStates()`, `db.getTransitions()`) that turned out to be wrong.

**Decision:** Use runtime introspection scripts (Node.js, importing Mermaid directly) to discover the actual `diag.db` shape for each diagram type before writing any parser code. Document verified data structures in a dedicated reference (`diagram-types-architecture.md`) that supersedes speculative §6.3 entries.

**Alternatives considered:**
1. *Read Mermaid source code directly* — fragile (internal structure changes between versions), time-consuming to trace through the build pipeline, and may not reveal the runtime shape accurately for bundled code.
2. *Use Mermaid TypeScript types* — Mermaid's internal types are not exported; `DiagramDB` is a loose interface with optional fields. Runtime is the only source of truth.
3. *Trial-and-error during implementation* — wastes TDD cycles; failing tests from wrong API assumptions create noise that obscures real test failures.

**Consequences:**
- (+) Every parser design is grounded in verified runtime data, not guesswork
- (+) Avoids wasted TDD cycles from incorrect API assumptions
- (+) Creates a reusable reference document for all 5 new diagram types
- (+) Mermaid version pinned at 11.4.1 — introspection results are version-locked
- (-) Introspection scripts must be re-run if Mermaid is upgraded
- (-) Small upfront time investment (~30 minutes for all 5 types)

---

## DEC-014 — D-01 shape fidelity: line polygons over version upgrade

**Date:** 2026-04-03  
**Module:** `packages/diagram` (D-01 — shape fidelity gap)

**Context:** Excalidraw has no native hexagon, cylinder, or parallelogram element types. Our current shape map approximates hexagon → diamond and cylinder/parallelogram → rectangle. PR #9477 ("feat: line polygons") added a `loopLock` feature for closed line polygons, but it is only available in pre-release builds ≥ 0.18.0-864353b (published May 27, 2025), not in our installed 0.17.6 or the 0.18.0 stable release.

**Decision:** Use `line` elements with closed point arrays (last point = first point) to render hexagon and parallelogram shapes on the current 0.17.6 version, without upgrading Excalidraw. Cylinder remains deferred (rectangle approximation) due to its curved-cap composition complexity.

**Alternatives considered:**
1. *Upgrade to 0.18.0-864353b+ pre-release for loopLock* — unstable pre-release, `loopLock` is a UI lock feature not required for programmatic polygon creation, introduces upgrade risk across the entire diagram package.
2. *Keep DEFER for all three shapes* — hexagon → diamond is a high fidelity gap (6 vertices vs 4), and the `line` polygon approach is confirmed viable with low-medium effort.
3. *Multi-element composition for all shapes* — high effort, fragile binding/grouping logic, not justified for hexagon/parallelogram where a single `line` polygon suffices.
4. *Wait for native Excalidraw shape types* — no indication these will ever be added; Excalidraw's minimal-shape philosophy is deliberate.

**Consequences:**
- (+) Hexagon and parallelogram fidelity significantly improved without version upgrade
- (+) `line` elements render with Rough.js hand-drawn style (consistent aesthetic)
- (+) Works on current 0.17.6 — no dependency churn
- (-) `line` polygons are not native containers — text must be a separate overlaid element
- (-) Selection/resize behavior differs from native shapes (less critical for programmatic rendering)
- (-) Cylinder remains a rectangle approximation until a better approach emerges

---

## DEC-015 — D-01 shape fidelity: Excalidraw library over programmatic polygon computation

**Date:** 2026-04-04  
**Module:** `packages/diagram` (D-01 — shape fidelity gap)

**Context:** Reconsidering DEC-014's "line polygon" approach after discovering the Excalidraw community library ecosystem at `libraries.excalidraw.com`. Libraries are distributed as `.excalidrawlib` files (simple JSON of Excalidraw elements) that can be loaded programmatically via `loadLibraryFromBlob()` + `excalidrawAPI.updateLibrary()`. Critically, the `lipis/polygons.excalidrawlib` community library already contains a hexagon shape, and `andreandreandradecosta/3d-shapes.excalidrawlib` contains a cylinder composition.

**Decision:** Supersede DEC-014's programmatic polygon computation with a **custom `accordo-mermaid-shapes.excalidrawlib`** library approach:
1. Draw all missing mermaid shapes (hexagon, parallelogram, trapezoid, subroutine, improved cylinder) in Excalidraw
2. Export via Excalidraw's library panel → produces `.excalidrawlib` JSON
3. Store in `packages/diagram/media/accordo-mermaid-shapes.excalidrawlib`
4. Load in webview init via `fetch()` + `loadLibraryFromBlob()` + `excalidrawAPI.updateLibrary()`
5. Reference library items in canvas generator

**Why library over programmatic polygon computation:**
- Shapes are hand-drawn once in Excalidraw — correct roughness, proportions, stroke baked in
- No TypeScript polygon vertex math — library IS the shape definition
- Can be updated/extended without code changes
- Rough.js rendering is guaranteed correct (from Excalidraw itself)
- Publishing to `libraries.excalidraw.com` benefits the wider Excalidraw community

**Existing libraries to leverage:**
- `lipis/polygons.excalidrawlib` → hexagon (flat-topped, 6 vertices)
- `andreandreandradecosta/3d-shapes.excalidrawlib` → cylinder (ellipse+rect composition — or draw better single shape)

**Shapes still needing custom library entries:** parallelogram, trapezoid, subroutine

**What this changes from DEC-014:**
- `types.ts` may NOT need `"line"` in the type union (if we use library items instead of programmatic `line` elements)
- `shape-map.ts` emits library item references rather than computed `line` point arrays
- Webview loads the library on init (one-time fetch of ~2KB JSON file)
- Canvas generator references library items by their element IDs

**Consequences:**
- (+) Shape quality is excellent — hand-drawn in Excalidraw by design
- (+) Maintainable — add shapes by drawing them, not computing math
- (+) Community could use the library directly
- (-) Requires webview to fetch + load library on init (minor latency, one-time)
- (-) Custom library must be created and maintained (small effort, high value)
