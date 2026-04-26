/**
 * Tests for src/tools/layout.ts — Module 20 + M74-LS
 *
 * Phase B — M76-VCGM removal cycle.
 * Layout tools accordo_layout_zen, accordo_layout_fullscreen,
 * accordo_layout_joinGroups, accordo_layout_evenGroups removed (M76-VCGM-02).
 * Remaining tools: layoutState (via factory) + bar tool from bar.ts.
 *
 * Requirement coverage:
 *   [x] §4.25 layout.state      — M74-LS: createLayoutTools factory, returns IDEState
 *   [x] Registration            — 0+1+1 tools (layoutTools[] empty + bar + state)
 *
 * Exported API checklist (dev-process.md §5 Phase B Coverage Audit):
 *   ✓ layoutStateHandler        — 4 tests (M74-LS-02, M74-LS-05, M74-LS-06, M74-LS-03)
 *   ✓ createLayoutTools()       — 4 tests (M74-LS-01, M74-LS-07, REG count, schemas, handlers)
 *   ✓ layoutTools[]             — registration test (toggle removed)
 *   ✓ removed tools absent      — M76-VCGM-02: zen/fullscreen/join/even NOT in layoutTools
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import {
  layoutTools,
  createLayoutTools,
  layoutStateHandler,
} from "../tools/layout.js";

import * as vscodeMock from "./mocks/vscode.js";
const { commands } = vscodeMock;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Layout state — M76-VCGM-02: zen/fullscreen/join/even REMOVED from layout.ts
// These migrated to generic gateway via accordo_vscode_command_execute
// (Tests removed; coverage via policy/gateway tests in vscode-command-execute-policy.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Registration — Module 20 (panel_toggle removed; layoutTools empty)
// ─────────────────────────────────────────────────────────────────────────────

describe("layoutTools registration — Module 20", () => {
  it("M20-REG-01: layoutTools exports no standalone tool definitions", () => {
    const names = layoutTools.map((t) => t.name);
    expect(names).toHaveLength(0);
    // M76-VCGM-02: removed tools
    expect(names).not.toContain("accordo_layout_zen");
    expect(names).not.toContain("accordo_layout_fullscreen");
    expect(names).not.toContain("accordo_layout_joinGroups");
    expect(names).not.toContain("accordo_layout_evenGroups");
    expect(names).not.toContain("accordo_panel_toggle");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.25 M74-LS: layoutStateHandler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tests for M74-LS: accordo_layout_state tool.
 * Requirements: requirements-editor.md §4.25
 */

function makeIDEState(overrides: Partial<IDEState> = {}): IDEState {
  return {
    activeFile: null,
    activeFileLine: 1,
    activeFileColumn: 1,
    openEditors: [],
    openTabs: [],
    visibleEditors: [],
    workspaceFolders: [],
    activeTerminal: null,
    workspaceName: null,
    remoteAuthority: null,
    modalities: {},
    ...overrides,
  };
}

describe("layoutStateHandler — §4.25 M74-LS", () => {
  // M74-LS-02: returns { ok: true, state } from getState()
  it("M74-LS-02: returns { ok: true, state } with full IDEState from getState()", async () => {
    const ideState = makeIDEState({ activeFile: "/workspace/main.ts", activeFileLine: 10 });
    const getState = vi.fn(() => ideState);
    const result = await layoutStateHandler({}, getState);
    expect(result).toEqual({ ok: true, state: ideState });
    expect(getState).toHaveBeenCalledOnce();
  });

  // M74-LS-03: state.openTabs is present (populated by getState)
  it("M74-LS-03: returned state includes openTabs field", async () => {
    const ideState = makeIDEState({
      openTabs: [
        { label: "arch.mmd", type: "webview", viewType: "accordo.diagram", isActive: true, groupIndex: 0 },
      ],
    });
    const getState = vi.fn(() => ideState);
    const result = await layoutStateHandler({}, getState);
    expect(result).toMatchObject({ ok: true });
    const okResult = result as { ok: true; state: IDEState };
    expect(okResult.state.openTabs).toHaveLength(1);
    expect(okResult.state.openTabs[0].viewType).toBe("accordo.diagram");
  });

  // M74-LS-04: state.modalities reflects latest per-extension state
  it("M74-LS-04: returned state.modalities contains latest per-extension state", async () => {
    const modalityData = {
      "accordo-comments": {
        isOpen: true,
        openThreadCount: 3,
        resolvedThreadCount: 1,
        summary: [],
      },
      "accordo-diagram": {
        panelOpen: true,
        diagramCount: 2,
      },
    };
    const ideState = makeIDEState({ modalities: modalityData });
    const getState = vi.fn(() => ideState);
    const result = await layoutStateHandler({}, getState);
    expect(result).toMatchObject({ ok: true });
    const okResult = result as { ok: true; state: IDEState };
    expect(okResult.state.modalities).toEqual(modalityData);
    expect(okResult.state.modalities["accordo-comments"]).toMatchObject({ openThreadCount: 3 });
    expect(okResult.state.modalities["accordo-diagram"]).toMatchObject({ diagramCount: 2 });
  });

  // M74-LS-05: returns { ok: false, error } when getState throws
  it("M74-LS-05: returns { ok: false, error } when getState() throws", async () => {
    const getState = vi.fn(() => { throw new Error("bridge disconnected"); });
    const result = await layoutStateHandler({}, getState);
    expect(result).toMatchObject({ ok: false, error: "bridge disconnected" });
  });

  // M74-LS-06: latency < 5ms (local in-memory read — wall-clock safe for CI)
  it("M74-LS-06: handler completes in under 5ms (local in-memory read)", async () => {
    const ideState = makeIDEState();
    const getState = vi.fn(() => ideState);
    const start = performance.now();
    await layoutStateHandler({}, getState);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });

  // M74-LS-08: accordo-comments payload is summary-only (no thread/comment bodies)
  it("M74-LS-08: strips heavy accordo-comments payload fields and bounds summary entries", async () => {
    const commentSummary = Array.from({ length: 25 }, (_, index) => ({
      threadId: `thread-${index}`,
      uri: `file:///tmp/file-${index}.md`,
      preview: `preview-${index}`,
      intent: "question",
      line: index + 1,
      surfaceType: "text",
      ignoredField: "ignore-me",
    }));

    const ideState = makeIDEState({
      modalities: {
        "accordo-comments": {
          isOpen: true,
          openThreadCount: 6,
          resolvedThreadCount: 1,
          summary: commentSummary,
          tools: "Review-thread tools: comment_list | comment_get",
          threads: [{ id: "thread-1", comments: [{ id: "c-1", body: "heavy" }] }],
        },
      },
    });

    const getState = vi.fn(() => ideState);
    const result = await layoutStateHandler({}, getState);
    expect(result).toMatchObject({ ok: true });

    const okResult = result as { ok: true; state: IDEState };
    const comments = okResult.state.modalities["accordo-comments"] as Record<string, unknown>;

    expect(comments["isOpen"]).toBe(true);
    expect(comments["openThreadCount"]).toBe(6);
    expect(comments["resolvedThreadCount"]).toBe(1);

    expect(comments).not.toHaveProperty("threads");
    expect(comments).not.toHaveProperty("tools");

    const summary = comments["summary"] as Array<Record<string, unknown>>;
    expect(summary).toHaveLength(20);
    expect(summary[0]).toEqual({
      threadId: "thread-0",
      uri: "file:///tmp/file-0.md",
      preview: "preview-0",
      intent: "question",
      line: 1,
      surfaceType: "text",
    });
    expect(summary[0]).not.toHaveProperty("ignoredField");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M74-LS: createLayoutTools() factory
// ─────────────────────────────────────────────────────────────────────────────

describe("createLayoutTools() factory — M74-LS", () => {
  const getState = vi.fn(() => makeIDEState());

  // M74-LS-01: accordo_layout_state is registered via createLayoutTools
  it("M74-LS-01: createLayoutTools returns array containing accordo_layout_state", () => {
    const tools = createLayoutTools(getState);
    const names = tools.map((t) => t.name);
    expect(names).toContain("accordo_layout_state");
  });

  it("M74-LS-01: createLayoutTools returns bar tool + layoutState (2 total)", () => {
    const tools = createLayoutTools(getState);
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("accordo_panel_toggle");
    // M76-VCGM-02: zen/fullscreen/joinGroups/evenGroups removed (migrated to generic gateway)
    expect(names).not.toContain("accordo_layout_zen");
    expect(names).not.toContain("accordo_layout_fullscreen");
    expect(names).not.toContain("accordo_layout_joinGroups");
    expect(names).not.toContain("accordo_layout_evenGroups");
    expect(names).toContain("accordo_layout_panel"); // E-6 consolidated bar tools into 1
    expect(names).toContain("accordo_layout_state");
  });

  it("M74-LS-01: accordo_layout_state has safe danger level and empty required schema", () => {
    const tools = createLayoutTools(getState);
    const stateTool = tools.find((t) => t.name === "accordo_layout_state")!;
    expect(stateTool.dangerLevel).toBe("safe");
    expect(stateTool.inputSchema.required).toEqual([]);
    expect(stateTool.inputSchema.type).toBe("object");
  });

  // M74-LS-07: tool description instructs agents to call at start of task
  it("M74-LS-07: accordo_layout_state description mentions calling at start of task", () => {
    const tools = createLayoutTools(getState);
    const stateTool = tools.find((t) => t.name === "accordo_layout_state")!;
    expect(stateTool.description.toLowerCase()).toMatch(/start|beginning|before/);
  });

  it("M74-LS-01: accordo_layout_state handler is a function", () => {
    const tools = createLayoutTools(getState);
    const stateTool = tools.find((t) => t.name === "accordo_layout_state")!;
    expect(typeof stateTool.handler).toBe("function");
  });
});
