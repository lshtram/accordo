/**
 * extension.test.ts — Part 3 of 4
 * Req: E2E-VCG-09 (gateway MCP tool handler after runtime init)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import { activate } from "../extension.js";
import * as vscodeMock from "./mocks/vscode.js";

// Shared state factory — avoids repetition across test setup blocks
function makeState(): IDEState {
  return {
    activeFile: null, activeFileLine: 1, activeFileColumn: 1,
    openEditors: [], openTabs: [], visibleEditors: [],
    workspaceFolders: [], activeTerminal: null,
    workspaceName: null, remoteAuthority: null, modalities: {},
  };
}

function makeBridge(state: IDEState) {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    getState: vi.fn().mockReturnValue(state),
  };
}

describe("extension activate — gateway handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeMock.mockState.workspaceFolders = [];
    vscodeMock.mockState.terminals = [];
    vscodeMock.mockState.activeTerminal = null;
  });

  // ── Test 4 ───────────────────────────────────────────────────────────────────

  it("registered gateway MCP tool handler is callable after runtime init", async () => {
    const state = makeState();
    const bridge = makeBridge(state);
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);
    (vscodeMock.commands as unknown as { getCommands: ReturnType<typeof vi.fn> }).getCommands =
      vi.fn().mockResolvedValue(["workbench.action.splitEditorRight", "accordo_editor_open"]);

    const context = new vscodeMock.ExtensionContext();
    await activate(context as never);
    const [, registeredTools] = bridge.registerTools.mock.calls[0] as [string, Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }>];
    const executeTool = registeredTools.find((t) => t.name === "accordo_vscode_command_execute");
    expect(executeTool).toBeDefined();
    const result = await executeTool!.handler({ command: "accordo_editor_open" }) as { ok: boolean; error?: { code?: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("POLICY_DENIED");
  });

  // ── Test 5 ───────────────────────────────────────────────────────────────────

  it("invoking gateway shim executes initialized runtime handler", async () => {
    const state = makeState();
    const bridge = makeBridge(state);
    vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);
    (vscodeMock.commands as unknown as { getCommands: ReturnType<typeof vi.fn> }).getCommands =
      vi.fn().mockResolvedValue(["workbench.action.splitEditorRight", "accordo_editor_open"]);

    const context = new vscodeMock.ExtensionContext();
    await activate(context as never);
    const registerCalls = vi.mocked(vscodeMock.commands.registerCommand).mock.calls;
    const executeEntry = registerCalls.find(([id]) => id === "accordo_vscode_command_execute");
    expect(executeEntry).toBeDefined();
    const executeShim = executeEntry?.[1] as (args: unknown) => Promise<unknown>;
    const result = await executeShim({ command: "accordo_editor_open" }) as { ok: boolean; error?: { code?: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("POLICY_DENIED");
  });
});
