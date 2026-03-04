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
    const tools = [makeTool("accordo.editor.open"), makeTool("accordo.terminal.run")];
    const result = renderPrompt(createEmptyState(), tools);
    expect(result).toContain("accordo.editor.open");
    expect(result).toContain("accordo.terminal.run");
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

  it("§2.3: renderPrompt step 3 — tool names only beyond top 10 (budget step 3)", () => {
    // req-hub §2.3: "Truncate tool list to name-only beyond top 10"
    const tools = Array.from({ length: 15 }, (_, i) =>
      makeTool(`accordo.tool.${i}`, `Unique description number ${i}`)
    );
    const result = renderPrompt(createEmptyState(), tools);
    for (let i = 0; i < 10; i++) {
      expect(result).toContain(`Unique description number ${i}`);
    }
    for (let i = 10; i < 15; i++) {
      expect(result).not.toContain(`Unique description number ${i}`);
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

  // ── Progressive tool disclosure ─────────────────────────────────────────

  it("§2.3: grouped tools are excluded from the prompt", () => {
    const tools = [
      makeTool("accordo.editor.open"),
      { ...makeTool("accordo.editor.scroll"), group: "editor" },
      { ...makeTool("accordo.editor.close"), group: "editor" },
    ];
    const result = renderPrompt(createEmptyState(), tools);
    expect(result).toContain("accordo.editor.open");
    expect(result).not.toContain("accordo.editor.scroll");
    expect(result).not.toContain("accordo.editor.close");
  });

  it("§2.3: discover tools (no group) appear while grouped tools are hidden", () => {
    const tools = [
      makeTool("accordo.editor.discover"),
      { ...makeTool("accordo.editor.open"), group: "editor" },
      { ...makeTool("accordo.editor.close"), group: "editor" },
      makeTool("accordo.terminal.discover"),
      { ...makeTool("accordo.terminal.run"), group: "terminal" },
    ];
    const result = renderPrompt(createEmptyState(), tools);
    expect(result).toContain("accordo.editor.discover");
    expect(result).toContain("accordo.terminal.discover");
    expect(result).not.toContain("accordo.editor.open");
    expect(result).not.toContain("accordo.editor.close");
    expect(result).not.toContain("accordo.terminal.run");
  });

  it("§2.3: budget guard uses visible tool count, not total", () => {
    // 4 discover tools (visible) + 20 grouped tools = 24 total.
    // Budget guard should only see 4 visible tools — well within top-10.
    const tools: ToolRegistration[] = [
      makeTool("accordo.editor.discover", "Discover editor tools"),
      makeTool("accordo.terminal.discover", "Discover terminal tools"),
      makeTool("accordo.layout.discover", "Discover layout tools"),
      makeTool("accordo.comments.discover", "Discover comment tools"),
    ];
    for (let i = 0; i < 20; i++) {
      tools.push({ ...makeTool(`accordo.hidden.${i}`, `Hidden tool ${i}`), group: "hidden" });
    }
    const result = renderPrompt(createEmptyState(), tools);
    // All 4 discover tools should have descriptions (they're within top 10)
    expect(result).toContain("Discover editor tools");
    expect(result).toContain("Discover terminal tools");
    // None of the hidden tools should appear
    expect(result).not.toContain("accordo.hidden.");
  });

  it("§2.3: all grouped tools are hidden — guardrail exposes all tools when no discover stub", () => {
    // P2: when ALL tools are grouped and there is no discover stub,
    // the prompt must NOT show "No tools registered" — it falls back to showing all tools.
    const tools = [
      { ...makeTool("accordo.editor.open"), group: "editor" },
      { ...makeTool("accordo.editor.close"), group: "editor" },
    ];
    const result = renderPrompt(createEmptyState(), tools);
    // Guardrail: tools are shown (agent is not blind) with a warning note
    expect(result).toContain("accordo.editor.open");
    expect(result).toContain("accordo.editor.close");
    expect(result).toContain("⚠");
    expect(result).not.toContain("No tools registered");
  });
});
