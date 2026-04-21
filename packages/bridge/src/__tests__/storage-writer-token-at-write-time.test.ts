/**
 * Tests for agent-config-sync.ts — storage-backed writer token-at-write-time.
 * Requirements: requirements-bridge.md CFG-07 (SWR-01 to SWR-03)
 *
 * CFG-07: token is read from the storage-backed source at write time.
 * The writer must call tokenSource.getHubToken before any write or rejection,
 * so hard-fallback restart cycles that update SecretStorage always produce
 * configs with the latest token.
 *
 * Authority split: syncMcpSettings() → user-level; writeAgentConfigsFromStorage() → workspace.
 *
 * API checklist: writeAgentConfigsFromStorage(params) [3 tests]
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFsState = vi.hoisted(() => ({ files: {} as Record<string, string>, writtenFiles: [] as { path: string; content: string }[] }));
vi.mock("node:fs", async () => {
  const actual = await import("node:fs");
  const state = mockFsState;
  return {
    ...actual,
    readFileSync: vi.fn((filePath: string) => {
      const content = state.files[filePath];
      if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
      return content;
    }),
    writeFileSync: vi.fn((filePath: string, data: string) => { state.files[filePath] = data; state.writtenFiles.push({ path: filePath, content: data }); }),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn((filePath: string) => { delete state.files[filePath]; }),
    existsSync: vi.fn((filePath: string) => filePath in state.files),
  };
});

import { writeAgentConfigsFromStorage } from "../agent-config-sync.js";
import type { StoredAgentConfigParams, AgentConfigTokenSource } from "../agent-config-sync.js";

function makeOutputChannel() { return { appendLine: vi.fn() }; }

describe("writeAgentConfigsFromStorage — storage token-at-write-time (SWR-01 to SWR-03)", () => {
  beforeEach(() => { mockFsState.files = {}; mockFsState.writtenFiles = []; vi.clearAllMocks(); });

  // SWR-01: CFG-07 — getHubToken called before any file write.
  // The token must be resolved from storage at write time, not request time.
  it("SWR-01: CFG-07 — writeAgentConfigsFromStorage calls tokenSource.getHubToken(projectId) before writing files", async () => {
    const getHubToken = vi.fn().mockResolvedValue("tok-from-storage");
    const params: StoredAgentConfigParams = {
      projectId: "test-project",
      port: 3000,
      configureOpencode: true,
      configureClaude: false,
      target: { kind: "workspace", workspaceRoot: "/workspace" },
      tokenSource: { getHubToken },
      outputChannel: makeOutputChannel(),
    };
    try { await writeAgentConfigsFromStorage(params); } catch { /* writer not fully implemented */ }
    // getHubToken must be called with the correct projectId
    expect(getHubToken).toHaveBeenCalledWith("test-project");
    // A workspace write is attempted (opencode.json)
    const opencodeWrites = mockFsState.writtenFiles.filter((f) => f.path.endsWith("opencode.json"));
    expect(opencodeWrites.length).toBeGreaterThan(0);
    // The written file must use the token from getHubToken, not any other value
    const writtenOpencode = JSON.parse(opencodeWrites[0].content);
    expect(writtenOpencode.mcp?.accordo?.headers?.Authorization).toBe("Bearer tok-from-storage");
  });

  // SWR-02: target.kind="none" is a safe no-op — zero file writes, no thrown error.
  it("SWR-02: target.kind='none' — writeAgentConfigsFromStorage is a no-op with zero file writes", async () => {
    const getHubToken = vi.fn().mockResolvedValue("tok");
    const params: StoredAgentConfigParams = {
      projectId: "test-project",
      port: 3000,
      configureOpencode: true,
      configureClaude: true,
      target: { kind: "none" },
      tokenSource: { getHubToken },
      outputChannel: makeOutputChannel(),
    };
    // none target must NOT throw
    await expect(writeAgentConfigsFromStorage(params)).resolves.toBeUndefined();
    // No file writes
    expect(mockFsState.writtenFiles.length).toBe(0);
  });

  // SWR-03: CFG-07 — when getHubToken returns undefined, the function rejects
  // with "token unavailable" (not "not implemented"). This signals to the caller
  // that the storage-backed token is not yet populated.
  it("SWR-03: CFG-07 — when getHubToken returns undefined, writeAgentConfigsFromStorage rejects with 'token unavailable'", async () => {
    const getHubToken = vi.fn().mockResolvedValue(undefined);
    const params: StoredAgentConfigParams = {
      projectId: "test-project",
      port: 3000,
      configureOpencode: true,
      configureClaude: false,
      target: { kind: "workspace", workspaceRoot: "/workspace" },
      tokenSource: { getHubToken },
      outputChannel: makeOutputChannel(),
    };
    let rejectionReason = "";
    try { await writeAgentConfigsFromStorage(params); } catch (err) { rejectionReason = err instanceof Error ? err.message : String(err); }
    expect(getHubToken).toHaveBeenCalledWith("test-project");
    expect(rejectionReason).toBe("token unavailable");
    expect(mockFsState.writtenFiles.length).toBe(0); // no writes when token is missing
  });
});