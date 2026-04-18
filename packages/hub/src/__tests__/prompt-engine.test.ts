/**
 * Tests for prompt-engine.ts
 * Requirements: requirements-hub.md §2.3, §5.3
 */

import { describe, it, expect } from "vitest";
import type { IDEState, ToolRegistration } from "@accordo/bridge-types";
import {
  PROMPT_TOKEN_BUDGET,
  PROMPT_EFFECTIVE_TOKEN_BUDGET,
  ACCORDO_PROTOCOL_VERSION,
} from "@accordo/bridge-types";
import { estimateTokens, renderPrompt } from "../prompt-engine.js";
import { createEmptyState } from "../state-cache.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeTool(name: string, description = "Does something useful"): ToolRegistration {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: {}, required: [] },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  };
}

function makeState(overrides: Partial<IDEState> = {}): IDEState {
  return { ...createEmptyState(), ...overrides };
}

// ── estimateTokens ────────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("§5.3: estimateTokens returns 0 for empty string", () => {
    // req-hub §5.3: estimateTokens(text) → number
    expect(estimateTokens("")).toBe(0);
  });

  it("§5.3: estimateTokens — 4 chars ≈ 1 token", () => {
    // req-hub §5.3: heuristic is chars / 4
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("§5.3: estimateTokens — 100 chars ≈ 25 tokens", () => {
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });

  it("§5.3: estimateTokens — 1600 chars ≈ 400 tokens", () => {
    expect(estimateTokens("x".repeat(1600))).toBe(400);
  });

  it("§5.3: estimateTokens handles single character without error", () => {
    // edge case: floors to 0 tokens for chars < 4
    expect(estimateTokens("a")).toBeGreaterThanOrEqual(0);
    expect(estimateTokens("a")).toBeLessThanOrEqual(1);
  });

  it("§5.3: PROMPT_EFFECTIVE_TOKEN_BUDGET is 10% below PROMPT_TOKEN_BUDGET", () => {
    expect(PROMPT_EFFECTIVE_TOKEN_BUDGET).toBe(1350);
    expect(PROMPT_TOKEN_BUDGET).toBe(1500);
    expect(PROMPT_EFFECTIVE_TOKEN_BUDGET).toBeLessThan(PROMPT_TOKEN_BUDGET);
    const margin = (PROMPT_TOKEN_BUDGET - PROMPT_EFFECTIVE_TOKEN_BUDGET) / PROMPT_TOKEN_BUDGET;
    expect(margin).toBeCloseTo(0.1, 2);
  });
});

// ── renderPrompt ──────────────────────────────────────────────────────────────

describe("renderPrompt", () => {
  it("§2.3: renderPrompt returns a non-empty string", () => {
    const result = renderPrompt(createEmptyState(), []);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("§2.3: renderPrompt includes activeFile path in dynamic section", () => {
    const state = makeState({ activeFile: "/workspace/main.ts" });
    const result = renderPrompt(state, []);
    expect(result).toContain("/workspace/main.ts");
  });

  it("§2.3: renderPrompt includes all workspace folders", () => {
    const state = makeState({ workspaceFolders: ["/repo/frontend", "/repo/backend"] });
    const result = renderPrompt(state, []);
    expect(result).toContain("/repo/frontend");
    expect(result).toContain("/repo/backend");
  });

  it("§2.3: renderPrompt includes open editor paths", () => {
    const state = makeState({ openEditors: ["/a.ts", "/b.ts"] });
    const result = renderPrompt(state, []);
    expect(result).toContain("/a.ts");
    expect(result).toContain("/b.ts");
  });

  it("§2.3: renderPrompt includes activeTerminal name", () => {
    const state = makeState({ activeTerminal: "bash" });
    const result = renderPrompt(state, []);
    expect(result).toContain("bash");
  });

  it("§2.3: renderPrompt includes all tool names in tool summary", () => {
    const tools = [makeTool("accordo_editor_open"), makeTool("accordo_terminal_run")];
    const result = renderPrompt(createEmptyState(), tools);
    expect(result).toContain("accordo_editor_open");
    expect(result).toContain("accordo_terminal_run");
  });

  it("§2.3: renderPrompt includes descriptions for tools 1–10", () => {
    const tools = Array.from({ length: 5 }, (_, i) =>
      makeTool(`accordo.tool.${i}`, `Description for tool ${i}`)
    );
    const result = renderPrompt(createEmptyState(), tools);
    for (const tool of tools) {
      expect(result).toContain(tool.description);
    }
  });

  it("§2.3: all tools get full descriptions when within budget", () => {
    // All tools get name + description — no cutoff at 10.
    const tools = Array.from({ length: 15 }, (_, i) =>
      makeTool(`accordo.tool.${i}`, `Unique description number ${i}`)
    );
    const result = renderPrompt(createEmptyState(), tools);
    for (let i = 0; i < 15; i++) {
      expect(result).toContain(`Unique description number ${i}`);
      expect(result).toContain(`accordo.tool.${i}`);
    }
  });

  it("§2.3: renderPrompt step 1 — null/empty state fields omitted when over budget", () => {
    // req-hub §2.3 budget step 1: Omit null/empty fields from state
    // A state with mostly null/empty fields should produce a shorter output
    // than one with all fields populated when both are over budget.
    const emptyState = createEmptyState(); // all fields null/empty
    const fullState = makeState({
      activeFile: "/workspace/active.ts",
      activeFileLine: 42,
      openEditors: Array.from({ length: 10 }, (_, i) => `/workspace/file${i}.ts`),
      workspaceFolders: ["/workspace"],
      activeTerminal: "bash",
    });
    const emptyResult = renderPrompt(emptyState, []);
    const fullResult = renderPrompt(fullState, []);
    // When budget is enforced, empty-state prompt must be <= full-state prompt in length
    // (empty fields were omitted in the empty-state render)
    expect(emptyResult.length).toBeLessThanOrEqual(fullResult.length);
    // Specifically: null activeFile must not appear as the string "null"
    expect(emptyResult).not.toContain("null");
  });

  it("§2.3: renderPrompt step 2 — modalities with isOpen !== true omitted when over budget", () => {
    // req-hub §2.3 budget step 2: Omit modality state for modalities where isOpen !== true
    const stateWithClosedModal = makeState({
      modalities: {
        "accordo-editor": { isOpen: false, data: "x".repeat(500) },
        "accordo-slides": { isOpen: true, slide: 1 },
      },
    });
    const stateWithNoModal = createEmptyState();
    const tools = Array.from({ length: 12 }, (_, i) =>
      makeTool(`accordo.tool.${i}`, "x".repeat(200))
    );
    const resultWithClosed = renderPrompt(stateWithClosedModal, tools);
    // The closed modality's data should NOT appear, but the open one should
    expect(resultWithClosed).not.toContain("x".repeat(500));
    // The open modality should still be referenced
    expect(resultWithClosed).toContain("accordo-slides");
  });

  it("§2.3+§5.3: total rendered prompt stays within token budget", () => {
    const state = makeState({
      activeFile: "/workspace/main.ts",
      openEditors: Array.from({ length: 20 }, (_, i) => `/workspace/file${i}.ts`),
      workspaceFolders: ["/workspace"],
    });
    // ToolRegistration spec caps description at 120 chars — test with the maximum.
    // renderPrompt does not truncate descriptions within the top-10 tools, so
    // exceeding the spec limit would violate the budget by design.
    const tools = Array.from({ length: 16 }, (_, i) =>
      makeTool(`accordo.tool.${i}`, "x".repeat(120))
    );
    const result = renderPrompt(state, tools);
    const estimatedTokens = estimateTokens(result);
    // Tolerance = PROMPT_TOKEN_BUDGET (1500, dynamic section) + ~300 (fixed prefix).
    // With spec-compliant 120-char descriptions this should land well under 1800.
    expect(estimatedTokens).toBeLessThanOrEqual(PROMPT_TOKEN_BUDGET + 300);
  });

  it("§2.3: renderPrompt with empty state contains no 'undefined' or 'null' strings", () => {
    const result = renderPrompt(createEmptyState(), []);
    expect(result).not.toContain("undefined");
    expect(result).not.toContain("null");
  });

  it("§2.3: renderPrompt has shared fixed prefix across different states", () => {
    // req-hub §2.3: "[Fixed prefix: ~300 tokens — identity, behaviour guidelines]"
    const result1 = renderPrompt(createEmptyState(), []);
    const result2 = renderPrompt(makeState({ activeFile: "/other.ts" }), []);
    const minLen = Math.min(result1.length, result2.length);
    const sharedPrefix = Array.from({ length: minLen }, (_, i) => i)
      .find((i) => result1[i] !== result2[i]) ?? minLen;
    expect(sharedPrefix).toBeGreaterThan(100);
  });

  // ── All tools are always visible (no progressive disclosure) ─────────────

  it("§2.3: grouped tools are included in the prompt alongside ungrouped tools", () => {
    const tools = [
      makeTool("accordo_editor_open"),
      { ...makeTool("accordo_editor_scroll"), group: "editor" },
      { ...makeTool("accordo_editor_close"), group: "editor" },
    ];
    const result = renderPrompt(createEmptyState(), tools);
    expect(result).toContain("accordo_editor_open");
    expect(result).toContain("accordo_editor_scroll");
    expect(result).toContain("accordo_editor_close");
  });

  it("§2.3: discover tools and all grouped tools appear together", () => {
    const tools = [
      makeTool("accordo_editor_discover"),
      { ...makeTool("accordo_editor_open"), group: "editor" },
      { ...makeTool("accordo_editor_close"), group: "editor" },
      makeTool("accordo_terminal_discover"),
      { ...makeTool("accordo_terminal_run"), group: "terminal" },
    ];
    const result = renderPrompt(createEmptyState(), tools);
    expect(result).toContain("accordo_editor_discover");
    expect(result).toContain("accordo_terminal_discover");
    expect(result).toContain("accordo_editor_open");
    expect(result).toContain("accordo_editor_close");
    expect(result).toContain("accordo_terminal_run");
  });

  it("§2.3: budget guard applies to all tools when over budget", () => {
    // 4 discover tools + 20 grouped tools = 24 total — all should appear.
    // Budget guard kicks in only when descriptions push past the effective budget.
    const tools: ToolRegistration[] = [
      makeTool("accordo_editor_discover", "Discover editor tools"),
      makeTool("accordo_terminal_discover", "Discover terminal tools"),
      makeTool("accordo_layout_discover", "Discover layout tools"),
      makeTool("accordo_comments_discover", "Discover comment tools"),
    ];
    for (let i = 0; i < 20; i++) {
      tools.push({ ...makeTool(`accordo.grouped.${i}`, `Grouped tool ${i}`), group: "grouped" });
    }
    const result = renderPrompt(createEmptyState(), tools);
    // All tools (discover + grouped) should appear
    expect(result).toContain("Discover editor tools");
    expect(result).toContain("Discover terminal tools");
    expect(result).toContain("accordo.grouped.0");
    expect(result).toContain("accordo.grouped.19");
  });

  it("§2.3: all tools shown even when all are grouped (no discover stubs)", () => {
    // No guardrail needed — all tools always show.
    const tools = [
      { ...makeTool("accordo_editor_open"), group: "editor" },
      { ...makeTool("accordo_editor_close"), group: "editor" },
    ];
    const result = renderPrompt(createEmptyState(), tools);
    expect(result).toContain("accordo_editor_open");
    expect(result).toContain("accordo_editor_close");
    expect(result).not.toContain("No tools registered");
  });
});

// ── M42: Open Comment Threads section ───────────────────────────────────────

describe("M42: Open Comment Threads section in system prompt", () => {
  function makeCommentModality(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      isOpen: true,
      openThreadCount: 0,
      resolvedThreadCount: 0,
      summary: [],
      ...overrides,
    };
  }

  it("§2.3-M42: no 'Open Comment Threads' section when openThreadCount is 0", () => {
    // req-hub §2.3-M42: Section omitted when openThreadCount === 0
    const state = makeState({
      modalities: { "accordo-comments": makeCommentModality({ openThreadCount: 0 }) },
    });
    const result = renderPrompt(state, []);
    expect(result).not.toContain("Open Comment Threads");
  });

  it("§2.3-M42: '## Open Comment Threads (N)' section rendered when openThreadCount > 0", () => {
    // req-hub §2.3-M42: Dedicated section appears when threads are present
    const state = makeState({
      modalities: {
        "accordo-comments": makeCommentModality({
          openThreadCount: 2,
          summary: [
            { threadId: "t1", uri: "src/auth.ts", line: 42, preview: "Fix the null check", intent: "fix" },
            { threadId: "t2", uri: "src/app.ts", preview: "Refactor this loop", intent: "refactor" },
          ],
        }),
      },
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("## Open Comment Threads (2)");
  });

  it("§2.3-M42: thread entry includes threadId, uri, line and intent for text-anchored thread", () => {
    // req-hub §2.3-M42: Exact entry format: - [threadId] uri:line — "preview" (intent)
    // These exact tokens are NOT present in the current JSON modality dump,
    // so this test is genuinely RED until M42 is implemented.
    const state = makeState({
      modalities: {
        "accordo-comments": makeCommentModality({
          openThreadCount: 1,
          summary: [
            { threadId: "t1", uri: "src/auth.ts", line: 42, preview: "Fix the null check", intent: "fix" },
          ],
        }),
      },
    });
    const result = renderPrompt(state, []);
    // Bracketed thread ID (not "threadId":"t1" JSON form)
    expect(result).toContain("[t1]");
    // colon-joined uri:line (not separate JSON fields)
    expect(result).toContain("src/auth.ts:42");
    // em-dash separator
    expect(result).toContain("— \"Fix the null check\"");
    // parenthetical intent
    expect(result).toContain("(fix)");
  });

  it("§2.3-M42: intent omitted from entry when not present on summary entry", () => {
    // req-hub §2.3-M42: Entry must be '[t1] uri:line — "preview"' with no trailing '(...)'
    // The current JSON dump doesn't use this format, so finding '[t1]' proves implementation.
    const state = makeState({
      modalities: {
        "accordo-comments": makeCommentModality({
          openThreadCount: 1,
          summary: [
            { threadId: "t1", uri: "src/foo.ts", line: 10, preview: "Needs review" },
          ],
        }),
      },
    });
    const result = renderPrompt(state, []);
    const t1Line = result.split("\n").find((l) => l.includes("[t1]"));
    expect(t1Line).toBeDefined();
    // Should include the preview
    expect(t1Line).toContain("— \"Needs review\"");
    // Must NOT end with a parenthetical group
    expect(t1Line).not.toMatch(/\([a-z]+\)\s*$/);
  });

  it("§2.3-M42: line number omitted for surface-anchored thread (no line field)", () => {
    // req-hub §2.3-M42: ':line' appended only when line field present in summary entry
    const state = makeState({
      modalities: {
        "accordo-comments": makeCommentModality({
          openThreadCount: 1,
          summary: [
            { threadId: "t1", uri: "doc.md", surfaceType: "markdown", preview: "Pin on surface", intent: "review" },
          ],
        }),
      },
    });
    const result = renderPrompt(state, []);
    const t1Line = result.split("\n").find((l) => l.includes("[t1]"));
    expect(t1Line).toBeDefined();
    // URI should appear without a colon-number suffix
    expect(t1Line).toContain("doc.md");
    expect(t1Line).not.toMatch(/doc\.md:\d/);
    // No undefined literals
    expect(t1Line).not.toContain("undefined");
  });

  it("§2.3-M42: accordo-comments NOT in generic Extension state block when threads section rendered", () => {
    // req-hub §2.3-M42: accordo-comments excluded from JSON modality dump when using dedicated section
    const state = makeState({
      modalities: {
        "accordo-comments": makeCommentModality({
          openThreadCount: 1,
          summary: [{ threadId: "t1", uri: "src/foo.ts", line: 1, preview: "test" }],
        }),
      },
    });
    const result = renderPrompt(state, []);
    expect(result).not.toContain('"openThreadCount"');
    expect(result).not.toContain('"summary"');
  });
});

// ── M51-SN: Voice section (simplified — narration controlled by plugin) ────────

/**
 * M51-SN v2.0: Hub prompt no longer includes automatic narration directives.
 * Narration is controlled exclusively by the OpenCode narration plugin
 * (ACCORDO_NARRATION_MODE env var). The Hub ## Voice section only
 * shows TTS availability.
 */
describe("M51-SN: Voice section in system prompt (minimal — plugin controls narration)", () => {
  function makeVoiceModality(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      isOpen: true,
      policy: {
        enabled: true,
        narrationMode: "narrate-off",
        speed: 1.0,
        voice: "af_sarah",
        language: "en-US",
      },
      ttsAvailable: true,
      ...overrides,
    };
  }

  it("M51-SN-01: '## Voice' section rendered when voice is enabled", () => {
    const state = makeState({
      modalities: { "accordo-voice": makeVoiceModality() },
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("## Voice");
  });

  it("M51-SN-01: no '## Voice' section when voice modality is absent", () => {
    const result = renderPrompt(createEmptyState(), []);
    expect(result).not.toContain("## Voice");
  });

  it("M51-SN-05: no '## Voice' section when policy.enabled is false", () => {
    const state = makeState({
      modalities: {
        "accordo-voice": makeVoiceModality({
          policy: { enabled: false, narrationMode: "narrate-off", speed: 1.0, voice: "af_sarah", language: "en-US" },
        }),
      },
    });
    const result = renderPrompt(state, []);
    expect(result).not.toContain("## Voice");
  });

  it("M51-SN-v2: voice section shows 'TTS available' when ttsAvailable is true", () => {
    const state = makeState({
      modalities: { "accordo-voice": makeVoiceModality({ ttsAvailable: true }) },
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("TTS available");
  });

  it("M51-SN-v2: voice section shows 'TTS unavailable' when ttsAvailable is false", () => {
    const state = makeState({
      modalities: { "accordo-voice": makeVoiceModality({ ttsAvailable: false }) },
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("TTS unavailable");
  });

  it("M51-SN-v2: no narration directive in voice section for any narrationMode (plugin is control plane)", () => {
    // Narrate-summary and narrate-everything modes are handled by the plugin, not Hub
    for (const mode of ["narrate-off", "narrate-summary", "narrate-everything"] as const) {
      const state = makeState({
        modalities: {
          "accordo-voice": makeVoiceModality({
            policy: { enabled: true, narrationMode: mode, speed: 1.0, voice: "af_sarah", language: "en-US" },
          }),
        },
      });
      const result = renderPrompt(state, []);
      expect(result).not.toContain("accordo_voice_readAloud");
      expect(result).not.toContain("spoken summary");
      expect(result).not.toContain("full response text");
    }
  });

  it("M51-SN-v2+M42: accordo-voice NOT in generic Extension state block", () => {
    const state = makeState({
      modalities: {
        "accordo-voice": makeVoiceModality(),
        "accordo-slides": { isOpen: true, slide: 1 },
      },
    });
    const result = renderPrompt(state, []);
    // accordo-slides should still appear in generic Extension state
    expect(result).toContain("accordo-slides");
    // accordo-voice should NOT appear in generic Extension state JSON
    // (it has its own ## Voice section)
    const extStateLine = result.split("\n").find((l) => l.includes("accordo-voice") && l.includes("{"));
    expect(extStateLine).toBeUndefined();
  });

  it("M51-SN-v2: prompt stays within token budget (minimal voice section)", () => {
    const state = makeState({
      modalities: { "accordo-voice": makeVoiceModality() },
      activeFile: "/workspace/main.ts",
      openEditors: Array.from({ length: 10 }, (_, i) => `/workspace/file${i}.ts`),
    });
    const tools = Array.from({ length: 16 }, (_, i) =>
      makeTool(`accordo.tool.${i}`, "x".repeat(120)),
    );
    const result = renderPrompt(state, tools);
    const tokens = estimateTokens(result);
    expect(tokens).toBeLessThanOrEqual(PROMPT_TOKEN_BUDGET + 300);
  });
});

// ── M74-PE: Open Tabs section ────────────────────────────────────────────────

/**
 * Tests for M74-PE: renderPrompt emits `## Open Tabs` section.
 * Requirements: requirements-hub.md §2.3 (M74-PE)
 * Architecture: docs/10-architecture/layout-state-architecture.md §3.3
 *
 * Coverage:
 *   M74-PE-01  section rendered when openTabs non-empty
 *   M74-PE-02  section omitted when openTabs empty or absent
 *   M74-PE-03  tabs grouped by groupIndex in ascending order
 *   M74-PE-04  active tab prefixed with [active]
 *   M74-PE-05  webview tabs annotated with (webview: viewType)
 *   M74-PE-06  text tabs show label only (no full path)
 *   M74-PE-07  section appears after editors, before comment threads
 *   M74-PE-08  token budget: truncate background groups first
 */

import { OPEN_TAB_TYPES, type OpenTab } from "@accordo/bridge-types";

function makeTab(overrides: Partial<OpenTab>): OpenTab {
  return {
    label: "untitled",
    type: "text",
    isActive: false,
    groupIndex: 0,
    ...overrides,
  };
}

describe("M74-PE: ## Open Tabs section in system prompt", () => {
  // M74-OT-01: bridge-types exports OPEN_TAB_TYPES as a runtime constant
  it("M74-OT-01: @accordo/bridge-types exports OPEN_TAB_TYPES runtime constant with all tab type strings", () => {
    expect(Array.isArray(OPEN_TAB_TYPES)).toBe(true);
    expect(OPEN_TAB_TYPES).toContain("text");
    expect(OPEN_TAB_TYPES).toContain("webview");
    expect(OPEN_TAB_TYPES).toContain("other");
  });

  // M74-PE-01: section rendered when openTabs is non-empty
  it("M74-PE-01: '## Open Tabs' section rendered when openTabs is non-empty", () => {
    const state = makeState({
      openTabs: [
        makeTab({ label: "server.ts", type: "text", path: "/workspace/server.ts", isActive: true, groupIndex: 0 }),
      ],
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("## Open Tabs");
  });

  // M74-PE-02: section omitted when openTabs is empty
  it("M74-PE-02: '## Open Tabs' section omitted when openTabs is empty", () => {
    const state = makeState({ openTabs: [] });
    const result = renderPrompt(state, []);
    expect(result).not.toContain("## Open Tabs");
  });

  // M74-PE-02: section omitted when openTabs absent (createEmptyState)
  it("M74-PE-02: '## Open Tabs' section omitted when openTabs absent from state", () => {
    const result = renderPrompt(createEmptyState(), []);
    expect(result).not.toContain("## Open Tabs");
  });

  // M74-PE-03: tabs grouped by groupIndex ascending
  it("M74-PE-03: tabs rendered grouped by groupIndex in ascending order", () => {
    const state = makeState({
      openTabs: [
        makeTab({ label: "a.ts",   type: "text",    path: "/a.ts",   isActive: false, groupIndex: 1 }),
        makeTab({ label: "b.mmd",  type: "webview",  viewType: "accordo.diagram", isActive: false, groupIndex: 0 }),
        makeTab({ label: "c.ts",   type: "text",    path: "/c.ts",   isActive: false, groupIndex: 0 }),
      ],
    });
    const result = renderPrompt(state, []);
    // Group 0 must appear before Group 1
    const group0Pos = result.indexOf("Group 0");
    const group1Pos = result.indexOf("Group 1");
    expect(group0Pos).toBeGreaterThanOrEqual(0);
    expect(group1Pos).toBeGreaterThan(group0Pos);
    // b.mmd and c.ts are in group 0, a.ts in group 1
    const bPos = result.indexOf("b.mmd");
    const aPos = result.indexOf("a.ts");
    expect(bPos).toBeLessThan(aPos);
  });

  // M74-PE-04: active tab prefixed with [active]
  it("M74-PE-04: active tab is prefixed with [active]", () => {
    const state = makeState({
      openTabs: [
        makeTab({ label: "active.ts", type: "text", path: "/active.ts", isActive: true,  groupIndex: 0 }),
        makeTab({ label: "other.ts",  type: "text", path: "/other.ts",  isActive: false, groupIndex: 0 }),
      ],
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("[active] active.ts");
    // other.ts should NOT have [active] prefix
    const otherLine = result.split("\n").find((l) => l.includes("other.ts"));
    expect(otherLine).toBeDefined();
    expect(otherLine).not.toContain("[active]");
  });

  // M74-PE-05: webview tabs annotated with (webview: viewType)
  it("M74-PE-05: webview tab shows label and (webview: viewType) annotation", () => {
    const state = makeState({
      openTabs: [
        makeTab({ label: "arch.mmd", type: "webview", viewType: "accordo.diagram", isActive: false, groupIndex: 0 }),
      ],
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("arch.mmd");
    expect(result).toContain("(webview: accordo.diagram)");
  });

  it("M74-PE-05: webview tab with [active] shows both markers", () => {
    const state = makeState({
      openTabs: [
        makeTab({ label: "Slide 3", type: "webview", viewType: "accordo.presentation", isActive: true, groupIndex: 0 }),
      ],
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("[active]");
    expect(result).toContain("Slide 3");
    expect(result).toContain("(webview: accordo.presentation)");
  });

  // M74-PE-06: text tabs show label only, not full path
  it("M74-PE-06: text tab shows label only, not full path, in Open Tabs section", () => {
    const state = makeState({
      openTabs: [
        makeTab({ label: "server.ts", type: "text", path: "/workspace/packages/hub/src/server.ts", isActive: false, groupIndex: 0 }),
      ],
    });
    const result = renderPrompt(state, []);
    // The full path must NOT appear inside the Open Tabs section
    // (it already appears in activeFile/openEditors)
    const tabsSection = result.slice(result.indexOf("## Open Tabs"));
    const afterTabsSection = tabsSection.indexOf("\n##");
    const openTabsBlock = afterTabsSection > 0 ? tabsSection.slice(0, afterTabsSection) : tabsSection;
    expect(openTabsBlock).not.toContain("/workspace/packages/hub/src/server.ts");
    // The label must appear
    expect(openTabsBlock).toContain("server.ts");
  });

  // M74-PE-07: section appears after editors section, before comment threads
  it("M74-PE-07: Open Tabs section appears before comment threads section", () => {
    const state = makeState({
      openTabs: [
        makeTab({ label: "file.ts", type: "text", path: "/file.ts", isActive: false, groupIndex: 0 }),
      ],
      modalities: {
        "accordo-comments": {
          isOpen: true,
          openThreadCount: 1,
          resolvedThreadCount: 0,
          summary: [
            { threadId: "t1", uri: "src/app.ts", line: 1, preview: "comment", intent: "fix" },
          ],
        },
      },
    });
    const result = renderPrompt(state, []);
    const openTabsPos   = result.indexOf("## Open Tabs");
    const commentPos    = result.indexOf("## Open Comment Threads");
    expect(openTabsPos).toBeGreaterThanOrEqual(0);
    expect(commentPos).toBeGreaterThan(openTabsPos);
  });

  it("M74-PE-07: Open Tabs section appears after active file / open editors content", () => {
    const state = makeState({
      activeFile: "/workspace/main.ts",
      openEditors: ["/workspace/main.ts"],
      openTabs: [
        makeTab({ label: "main.ts", type: "text", path: "/workspace/main.ts", isActive: true, groupIndex: 0 }),
      ],
    });
    const result = renderPrompt(state, []);
    const editorsPos = result.indexOf("/workspace/main.ts");
    const openTabsPos = result.indexOf("## Open Tabs");
    expect(editorsPos).toBeGreaterThanOrEqual(0);
    expect(openTabsPos).toBeGreaterThan(editorsPos);
  });

  // M74-PE-08: token budget — truncate background groups (highest groupIndex) first
  it("M74-PE-08: token budget: background groups truncated first, active tab preserved", () => {
    // Create many groups to stress the token budget
    const manyTabs: OpenTab[] = [];
    // Group 0: one active text tab
    manyTabs.push(makeTab({ label: "active.ts", type: "text", path: "/active.ts", isActive: true, groupIndex: 0 }));
    // Groups 1-99: background groups with tabs (high groupIndex = truncated first)
    for (let g = 1; g <= 99; g++) {
      for (let t = 0; t < 10; t++) {
        manyTabs.push(makeTab({
          label: `bg-g${g}-t${t}.ts`,
          type: "text",
          path: `/bg/g${g}/t${t}.ts`,
          isActive: false,
          groupIndex: g,
        }));
      }
    }
    const state = makeState({ openTabs: manyTabs });
    // Use enough tools to guarantee the token budget is exceeded and truncation fires
    const tools = Array.from({ length: 50 }, (_, i) => makeTool(`tool.${i}`, "x".repeat(200)));
    const result = renderPrompt(state, tools);
    // The active tab in group 0 must always be present
    expect(result).toContain("active.ts");
    // The dynamic section (state + tools) is bounded by PROMPT_EFFECTIVE_TOKEN_BUDGET = 1350.
    // FIXED_PREFIX (~550 tokens) sits outside the dynamic budget.
    // Total prompt = FIXED_PREFIX + dynamic ≤ ~550 + 1350 = ~1900 tokens.
    expect(estimateTokens(result)).toBeLessThanOrEqual(PROMPT_TOKEN_BUDGET + 700);
    // Truncation order: highest groupIndex (group 99) must be dropped before lower groups.
    // With the budget deliberately overflowed, group 99 tabs MUST be absent.
    expect(result).not.toContain("bg-g99-t0.ts");
    // Group 1 (lowest-index background group) must still be present —
    // it is the last background group to be dropped.
    expect(result).toContain("bg-g1-t0.ts");
  });
});
