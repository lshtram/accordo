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

// ── M51-SN: Voice section + narration directive ─────────────────────────────

describe("M51-SN: Voice section + narration directive in system prompt", () => {
  function makeVoiceModality(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      isOpen: true,
      session: "active",
      narration: "idle",
      audio: "idle",
      policy: {
        enabled: true,
        narrationMode: "narrate-summary",
        speed: 1.0,
        voice: "af_sarah",
        language: "en-US",
      },
      sttAvailable: true,
      ttsAvailable: true,
      ...overrides,
    };
  }

  it("M51-SN-01: '## Voice' section rendered when voice modality is present and enabled", () => {
    // req-voice M51-SN-01: section appears when voice state published with policy.enabled = true
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
    // req-voice M51-SN-05: directive only when policy.enabled is true
    const state = makeState({
      modalities: {
        "accordo-voice": makeVoiceModality({
          policy: {
            enabled: false,
            narrationMode: "narrate-summary",
            speed: 1.0,
            voice: "af_sarah",
            language: "en-US",
          },
        }),
      },
    });
    const result = renderPrompt(state, []);
    expect(result).not.toContain("## Voice");
  });

  it("M51-SN-02: narrate-summary directive contains the exact required text", () => {
    // req-voice M51-SN-02: exact directive wording for narrate-summary
    const state = makeState({
      modalities: { "accordo-voice": makeVoiceModality() },
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("call accordo_voice_readAloud");
    expect(result).toContain("2-3 sentence spoken summary");
    expect(result).toContain("Do not repeat the full response");
  });

  it("M51-SN-04: narrate-everything directive instructs full response readback", () => {
    // req-voice M51-SN-04: different directive for narrate-everything
    const state = makeState({
      modalities: {
        "accordo-voice": makeVoiceModality({
          policy: {
            enabled: true,
            narrationMode: "narrate-everything",
            speed: 1.0,
            voice: "af_sarah",
            language: "en-US",
          },
        }),
      },
    });
    const result = renderPrompt(state, []);
    expect(result).toContain("call accordo_voice_readAloud");
    expect(result).toContain("full response text");
    expect(result).toContain("text cleaning pipeline");
  });

  it("M51-SN-03: narrate-off produces no narration directive", () => {
    // req-voice M51-SN-03: no directive when narrate-off
    const state = makeState({
      modalities: {
        "accordo-voice": makeVoiceModality({
          policy: {
            enabled: true,
            narrationMode: "narrate-off",
            speed: 1.0,
            voice: "af_sarah",
            language: "en-US",
          },
        }),
      },
    });
    const result = renderPrompt(state, []);
    // The Voice section may still render (status info), but no narration directive
    expect(result).not.toContain("accordo_voice_readAloud");
    expect(result).not.toContain("spoken summary");
    expect(result).not.toContain("full response text");
  });

  it("M51-SN-01: voice status line includes session and provider availability", () => {
    // The ## Voice section must show human-readable status
    const state = makeState({
      modalities: {
        "accordo-voice": makeVoiceModality({
          session: "active",
          sttAvailable: true,
          ttsAvailable: true,
        }),
      },
    });
    const result = renderPrompt(state, []);
    // Expect readable status like "Active" and provider names
    expect(result).toContain("Active");
    // Should mention STT and TTS availability
    expect(result).toMatch(/STT|Whisper/i);
    expect(result).toMatch(/TTS|Kokoro/i);
  });

  it("M51-SN-01: voice mode line includes narrationMode, speed, and voice — in ## Voice section", () => {
    // Strings must appear inside the dedicated ## Voice section, not just anywhere
    // in the raw JSON modality dump (false-green guard).
    const state = makeState({
      modalities: {
        "accordo-voice": makeVoiceModality({
          policy: {
            enabled: true,
            narrationMode: "narrate-summary",
            speed: 1.5,
            voice: "bf_emma",
            language: "en-US",
          },
        }),
      },
    });
    const result = renderPrompt(state, []);
    // Extract the ## Voice section (everything from the header to the next ## header)
    const voiceSection = result.match(/## Voice[\s\S]*?(?=\n## |\n\n##|$)/)?.[0] ?? "";
    expect(voiceSection).toBeTruthy(); // section must exist
    expect(voiceSection).toContain("narrate-summary");
    expect(voiceSection).toContain("1.5");
    expect(voiceSection).toContain("bf_emma");
  });

  it("M51-SN-05+M42: accordo-voice NOT in generic Extension state block", () => {
    // Same pattern as M42: voice gets a dedicated section, excluded from JSON dump
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

  it("M51-SN-06: prompt stays within token budget with voice directive", () => {
    // req-voice M51-SN-06: ~60 tokens for directive, must fit in budget
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
