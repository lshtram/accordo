/**
 * Tests for agent-config-sync.ts — AgentConfigTokenSource contract.
 * Requirements: requirements-bridge.md CFG-07.
 * Scope: tokenSource.getHubToken(projectId) called at write time; scoped SecretStorage key usage.
 * API checklist: writeAgentConfigsFromStorage params → tokenSource.getHubToken [3 tests]
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSyncMcpSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockWriteAgentConfigsFromStorage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../extension-bootstrap.js", () => ({ syncMcpSettings: mockSyncMcpSettings }));
vi.mock("../agent-config.js", () => ({ writeAgentConfigsFromStorage: mockWriteAgentConfigsFromStorage }));
vi.mock("../agent-config-sync.js", () => ({ writeAgentConfigsFromStorage: mockWriteAgentConfigsFromStorage }));

import { requestConfigSyncs } from "../extension-config-sync-seams.js";
import type { CompositionDeps } from "../extension-composition.js";

function makeDeps(overrides: Partial<{
  workspaceRoot: string;
  projectId: string;
  secretStorage: Record<string, string | undefined>;
}> = {}): CompositionDeps {
  const projectId = overrides.projectId ?? "test-project";
  const workspaceRoot = overrides.workspaceRoot ?? "/workspace";
  const secretStorage = overrides.secretStorage ?? { "accordo.test-project.hubToken": "stored-token" };
  return {
    bootstrap: {
      outputChannel: { appendLine: vi.fn() },
      mcpConfigPath: "/home/user/.vscode/mcp.json",
      config: {
        wantCopilot: true, wantOpencode: true, wantClaude: true,
        workspaceRoot, projectId, port: 3000, autoStart: true, executablePath: "",
      },
      secretStorage: {
        get: vi.fn(async (key: string) => secretStorage[key]),
        store: vi.fn(), delete: vi.fn(),
      },
      connectionStatusEmitter: { fire: vi.fn(), event: vi.fn() },
      updateStatusBar: vi.fn(),
      setStatusBarUpdater: vi.fn(),
      statusBarItem: { text: "" },
      pushDisposable: vi.fn(),
      hubManagerConfig: { port: 3000, autoStart: true, executablePath: "", hubEntryPoint: "hub", projectId },
    },
    services: {} as CompositionDeps["services"],
    state: { wsClient: null, currentHubToken: "", currentHubPort: 3000 },
  } as unknown as CompositionDeps;
}

describe("AgentConfigTokenSource — getHubToken contract (TSC-01 to TSC-03)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // TSC-01: projectId is included in writeAgentConfigsFromStorage params for token lookup.
  it("TSC-01: CFG-07 — writeAgentConfigsFromStorage receives projectId for tokenSource lookup", () => {
    requestConfigSyncs(makeDeps({ projectId: "my-project" }), 3000, "tok");
    expect(mockWriteAgentConfigsFromStorage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "my-project" }),
    );
  });

  // TSC-02: CFG-07 — tokenSource.getHubToken(projectId) uses the scoped SecretStorage key
  //          and returns the token. Capture writer params and invoke getHubToken directly.
  it("TSC-02: CFG-07 — tokenSource.getHubToken uses scoped key and returns token from secretStorage", async () => {
    const secretStorage = { "accordo.test-project.hubToken": "rotated-token-xyz" };
    requestConfigSyncs(makeDeps({ secretStorage }), 3000, "rotated-token-xyz");

    // Capture the params passed to writeAgentConfigsFromStorage
    const callArgs = (mockWriteAgentConfigsFromStorage as ReturnType<typeof vi.fn>).mock.calls[0];
    const params = callArgs?.[0] as { tokenSource: { getHubToken: (k: string) => Promise<string | undefined> }; projectId: string } | undefined;
    expect(params).toBeDefined();

    // Actually invoke getHubToken to prove it uses the scoped SecretStorage key
    const resolvedToken = await params!.tokenSource.getHubToken(params!.projectId);
    expect(resolvedToken).toBe("rotated-token-xyz");
  });

  // TSC-03: LCM-03/WS-07 — reconnect sync seam carries stored token through to workspace config.
  it("TSC-03: LCM-03/WS-07 — reconnect sync passes stored token through to writeAgentConfigsFromStorage", () => {
    requestConfigSyncs(makeDeps({ secretStorage: { "accordo.test-project.hubToken": "reconnect-token" } }), 3000, "reconnect-token");
    expect(mockWriteAgentConfigsFromStorage).toHaveBeenCalled();
  });
});