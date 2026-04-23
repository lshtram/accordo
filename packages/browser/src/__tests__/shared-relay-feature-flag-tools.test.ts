import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate, createExtensionContextMock, createVscodeMock, makeBridgeMock, sharedFsState, vscode } from "./shared-relay-feature-flag-fixtures.js";

describe("shared relay feature flag - tool parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFsState.clear();
  });

  it("shared mode registers expected browser tools", async () => {
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });
    const mockVscode = createVscodeMock(true);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mockVscode.workspace.getConfiguration;
    await activate(createExtensionContextMock() as never);
    const [, tools] = bridge.registerTools.mock.calls[0] as [string, Array<{ name: string }>];
    const names = tools.map((t) => t.name);
    expect(names).toContain("accordo_browser_get_page_map");
    expect(names).toContain("accordo_browser_wait_for");
    expect(names).toContain("accordo_browser_get_text_map");
    expect(names).toContain("accordo_browser_get_semantic_graph");
    expect(names).toContain("accordo_browser_diff_snapshots");
  });

  it("per-window mode registers the same core browser tools", async () => {
    const bridge = makeBridgeMock();
    (vscode.extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue({ exports: bridge });
    const mockVscode = createVscodeMock(false);
    (vscode.workspace as Record<string, unknown>).getConfiguration = mockVscode.workspace.getConfiguration;
    await activate(createExtensionContextMock() as never);
    const [, tools] = bridge.registerTools.mock.calls[0] as [string, Array<{ name: string }>];
    const names = tools.map((t) => t.name);
    expect(names).toContain("accordo_browser_get_page_map");
    expect(names).toContain("accordo_browser_wait_for");
    expect(names).toContain("accordo_browser_get_text_map");
    expect(names).toContain("accordo_browser_diff_snapshots");
  });
});
