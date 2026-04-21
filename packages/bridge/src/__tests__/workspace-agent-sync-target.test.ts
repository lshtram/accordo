/**
 * Tests for agent-config-sync.ts — WorkspaceAgentConfigTarget union dispatch
 *
 * Requirements: none — no formal requirement covers explicit target-union dispatch shape
 *
 * Scope: verifies the target union discriminates workspace vs no-workspace
 * behavior WITHOUT calling the "not implemented" writer stub directly.
 * Uses mockWriteAgentConfigsFromStorage to observe the params that would
 * be passed if the writer were implemented.
 *
 * API checklist:
 * - WorkspaceAgentConfigTarget union dispatch in requestConfigSyncs [2 tests]
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSyncMcpSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockWriteAgentConfigsFromStorage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../extension-bootstrap.js", () => ({ syncMcpSettings: mockSyncMcpSettings }));
vi.mock("../agent-config.js", () => ({ writeAgentConfigsFromStorage: mockWriteAgentConfigsFromStorage }));
vi.mock("../agent-config-sync.js", () => ({ writeAgentConfigsFromStorage: mockWriteAgentConfigsFromStorage }));

import { requestConfigSyncs } from "../extension-config-sync-seams.js";
import type { CompositionDeps } from "../extension-composition.js";

function makeDeps(workspaceRoot = "/workspace"): CompositionDeps {
  return {
    bootstrap: {
      outputChannel: { appendLine: vi.fn() },
      mcpConfigPath: "/home/user/.vscode/mcp.json",
      config: {
        wantCopilot: true,
        wantOpencode: true,
        wantClaude: true,
        workspaceRoot,
        projectId: "test-project",
        port: 3000,
        autoStart: true,
        executablePath: "",
      },
      secretStorage: { get: vi.fn().mockResolvedValue("stored-token"), store: vi.fn(), delete: vi.fn() },
      connectionStatusEmitter: { fire: vi.fn(), event: vi.fn() },
      updateStatusBar: vi.fn(),
      setStatusBarUpdater: vi.fn(),
      statusBarItem: { text: "" },
      pushDisposable: vi.fn(),
      hubManagerConfig: { port: 3000, autoStart: true, executablePath: "", hubEntryPoint: "hub", projectId: "test-project" },
    },
    services: {} as CompositionDeps["services"],
    state: { wsClient: null, currentHubToken: "", currentHubPort: 3000 },
  } as unknown as CompositionDeps;
}

describe("WorkspaceAgentConfigTarget union dispatch (TGT-01 to TGT-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // TGT-01: workspace-root dispatch — when workspaceRoot is set, dispatcher passes kind="workspace"
  it("TGT-01: workspace-root dispatch — requestConfigSyncs dispatches with target.kind='workspace' when workspaceRoot is set", () => {
    requestConfigSyncs(makeDeps("/workspace"), 3000, "token");

    expect(mockWriteAgentConfigsFromStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "workspace", workspaceRoot: "/workspace" },
      }),
    );
  });

  // TGT-02: no-workspace dispatch — when workspaceRoot is absent, dispatcher passes kind="none" (no-op)
  it("TGT-02: no-workspace dispatch — requestConfigSyncs dispatches with target.kind='none' when workspaceRoot is empty", () => {
    requestConfigSyncs(makeDeps(""), 3000, "token");

    expect(mockWriteAgentConfigsFromStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "none" },
      }),
    );
  });
});