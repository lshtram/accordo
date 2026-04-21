import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSyncMcpSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockWriteAgentConfigsFromStorage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../extension-bootstrap.js", () => ({ syncMcpSettings: mockSyncMcpSettings }));
vi.mock("../agent-config-sync.js", () => ({ writeAgentConfigsFromStorage: mockWriteAgentConfigsFromStorage }));

import { requestConfigSyncs } from "../extension-config-sync-seams.js";
import type { CompositionDeps } from "../extension-composition.js";

function makeDeps(workspaceRoot = "/workspace"): CompositionDeps {
  return {
    bootstrap: {
      outputChannel: { appendLine: vi.fn() },
      mcpConfigPath: "/home/user/.vscode/mcp.json",
      config: { wantCopilot: true, wantOpencode: true, wantClaude: true, workspaceRoot, projectId: "p", port: 3000, autoStart: true, executablePath: "" },
      secretStorage: { get: vi.fn().mockResolvedValue("stored-token"), store: vi.fn(), delete: vi.fn() },
      connectionStatusEmitter: { fire: vi.fn(), event: vi.fn() },
      updateStatusBar: vi.fn(),
      setStatusBarUpdater: vi.fn(),
      statusBarItem: { text: "" },
      pushDisposable: vi.fn(),
      hubManagerConfig: { port: 3000, autoStart: true, executablePath: "", hubEntryPoint: "hub", projectId: "p" },
    },
    services: {} as CompositionDeps["services"],
    state: { wsClient: null, currentHubToken: "", currentHubPort: 3000 },
  } as unknown as CompositionDeps;
}

describe("requestConfigSyncs", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requests both authorities with workspace target when workspace root exists", () => {
    requestConfigSyncs(makeDeps("/workspace"), 3000, "tok");
    expect(mockSyncMcpSettings).toHaveBeenCalledWith(expect.any(Object), "/home/user/.vscode/mcp.json", 3000, "tok");
    expect(mockWriteAgentConfigsFromStorage).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: "workspace", workspaceRoot: "/workspace" } }));
  });

  it("uses target.kind='none' for workspace sync when no workspace root exists", () => {
    requestConfigSyncs(makeDeps(""), 3000, "tok");
    expect(mockWriteAgentConfigsFromStorage).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: "none" } }));
  });
});
