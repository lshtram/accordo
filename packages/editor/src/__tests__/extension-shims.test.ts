/**
 * extension.test.ts — Part 4 of 4
 * Req: E2E-VCG-09 (command shims — layout and editor)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import { activate } from "../extension.js";
import * as vscodeMock from "./mocks/vscode.js";

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

async function activateWithBridge(state: IDEState) {
  const bridge = makeBridge(state);
  vi.mocked(vscodeMock.extensions.getExtension).mockReturnValue({ exports: bridge } as never);
  vi.mocked(vscodeMock.commands.executeCommand).mockResolvedValue(undefined);
  const context = new vscodeMock.ExtensionContext();
  await activate(context as never);
  return { bridge, context };
}

function findShim(cmdId: string) {
  const calls = vi.mocked(vscodeMock.commands.registerCommand).mock.calls;
  const entry = calls.find(([id]) => id === cmdId);
  return entry?.[1] as (args: unknown) => unknown;
}

describe("extension activate — command shims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeMock.mockState.workspaceFolders = [];
    vscodeMock.mockState.terminals = [];
    vscodeMock.mockState.activeTerminal = null;
  });

  // ── Test 6 ───────────────────────────────────────────────────────────────────

  it("invoking a registered command shim hits the real tool handler via deps", async () => {
    const state = makeState();
    const { bridge } = await activateWithBridge(state);
    const shim = findShim("accordo_layout_state");
    expect(shim).toBeDefined();
    const result = await shim({});
    expect(result).toHaveProperty("ok", true);
    expect(result).toHaveProperty("state");
    expect(bridge.getState).toHaveBeenCalled();
  });

  // ── Test 7 ───────────────────────────────────────────────────────────────────
  // M76-VCGM-01: accordo_editor_split shim removed (migrated to generic gateway).
  // Test that a remaining editor tool shim still works correctly.

  it("invoking remaining editor shim executes real handler via deps", async () => {
    const state = makeState();
    await activateWithBridge(state);
    // Use accordo_editor_clearHighlights (remaining) to verify shim mechanism still works
    // clearHighlights with no args returns { cleared: true, count: 0 }
    const shim = findShim("accordo_editor_clearHighlights");
    expect(shim).toBeDefined();
    const result = await shim({});
    expect(result).toHaveProperty("cleared", true);
    expect(result).toHaveProperty("count", 0);
  });

  // ── Test 8 ───────────────────────────────────────────────────────────────────
  // M76-VCGM-01: removed editor shims are not registered

  it("accordo_editor_split shim is ABSENT (migrated to generic gateway)", async () => {
    await activateWithBridge(makeState());
    expect(findShim("accordo_editor_split")).toBeUndefined();
  });

  it("accordo_editor_reveal shim is ABSENT (migrated to generic gateway)", async () => {
    await activateWithBridge(makeState());
    expect(findShim("accordo_editor_reveal")).toBeUndefined();
  });

  it("accordo_editor_save shim is ABSENT (migrated to generic gateway)", async () => {
    await activateWithBridge(makeState());
    expect(findShim("accordo_editor_save")).toBeUndefined();
  });

  it("accordo_editor_saveAll shim is ABSENT (migrated to generic gateway)", async () => {
    await activateWithBridge(makeState());
    expect(findShim("accordo_editor_saveAll")).toBeUndefined();
  });

  it("accordo_editor_format shim is ABSENT (migrated to generic gateway)", async () => {
    await activateWithBridge(makeState());
    expect(findShim("accordo_editor_format")).toBeUndefined();
  });
});
