/**
 * M52-EXT — extension.ts tests (Phase B — must FAIL before implementation)
 * Coverage: M52-EXT-01 through M52-EXT-13
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate, deactivate, type BridgeAPI } from "../extension.js";
import {
  commands,
  extensions,
  workspace,
  window,
  createExtensionContextMock,
} from "./mocks/vscode.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBridge(): BridgeAPI {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    onConnectionStatusChanged: vi.fn(() => ({ dispose: vi.fn() })) as unknown as BridgeAPI["onConnectionStatusChanged"],
  };
}

function setupBridge(bridge: BridgeAPI | undefined): void {
  (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
    (id: string) => id === "accordo.accordo-bridge"
      ? (bridge ? { exports: bridge, isActive: true } : undefined)
      : undefined,
  );
}

function setupVoiceInstalled(installed: boolean): void {
  const originalGetExtension = (extensions as Record<string, unknown>).getExtension as ReturnType<typeof vi.fn>;
  const bridgeMock = originalGetExtension.mock.results[0]?.value;

  (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
    (id: string) => {
      if (id === "accordo.accordo-bridge") return bridgeMock;
      if (id === "accordo.accordo-voice") return installed ? { exports: {}, isActive: true } : undefined;
      return undefined;
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── M52-EXT-00: exports ──────────────────────────────────────────────────────

describe("M52-EXT exports", () => {
  it("activate is exported as a function", () => {
    expect(typeof activate).toBe("function");
  });

  it("deactivate is exported as a function", () => {
    expect(typeof deactivate).toBe("function");
  });
});

// ── M52-EXT-01: activation ───────────────────────────────────────────────────

describe("M52-EXT-01 activation returns ScriptExtensionApi", () => {
  it("returns an object with a runner", () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();
    const api = activate(ctx);
    expect(api.runner).toBeDefined();
  });
});

// ── M52-EXT-02: bridge acquisition ───────────────────────────────────────────

describe("M52-EXT-02 bridge acquisition", () => {
  it("queries extensions for accordo.accordo-bridge", () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();
    activate(ctx);
    expect(extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-bridge");
  });
});

// ── M52-EXT-10: accordo.script.stop command ──────────────────────────────────

describe("M52-EXT-10 accordo.script.stop command", () => {
  it("registers the accordo.script.stop VS Code command", () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();
    activate(ctx);

    expect(commands.registerCommand).toHaveBeenCalledWith(
      "accordo.script.stop",
      expect.any(Function),
    );
  });

  it("calling accordo.script.stop calls runner.stop()", () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();
    const api = activate(ctx);
    vi.spyOn(api.runner, "stop").mockResolvedValue(undefined);

    // Find and invoke the registered handler
    const [, handler] = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([name]) => name === "accordo.script.stop",
    ) ?? [];
    (handler as () => void)();

    expect(api.runner.stop).toHaveBeenCalled();
  });
});

// ── M52-EXT-03: subtitle bar ─────────────────────────────────────────────────

describe("M52-EXT-03 ScriptSubtitleBar created", () => {
  it("creates a status bar item via window.createStatusBarItem", () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();
    activate(ctx);
    expect(window.createStatusBarItem).toHaveBeenCalled();
  });
});

// ── M52-EXT-04: executeCommand wiring ────────────────────────────────────────

describe("M52-EXT-04 executeCommand wiring", () => {
  it("runner.deps.executeCommand calls vscode.commands.executeCommand", async () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();
    const api = activate(ctx);
    const onComplete = vi.fn();

    // Run a command step; if deps.executeCommand routes through vscode.commands.executeCommand
    // then commands.executeCommand should be called
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    api.runner.run(
      { steps: [{ type: "command", command: "test.cmd" }] },
      // @ts-expect-error — inject callbacks directly for test
      { onComplete },
    );

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 1000 });
    expect(commands.executeCommand).toHaveBeenCalledWith("test.cmd", undefined);
  });
});

// ── M52-EXT-05: speakText wiring ─────────────────────────────────────────────

describe("M52-EXT-05 speakText wiring", () => {
  it("speakText dep absent when voice extension not installed", () => {
    const bridge = makeBridge();
    setupBridge(bridge);
    setupVoiceInstalled(false);

    const ctx = createExtensionContextMock();
    const api = activate(ctx);

    // Access internal deps — the runner should have been constructed without speakText
    // We verify indirectly: run a speak step and confirm commands.executeCommand
    //  is NOT called with accordo.voice.speakText
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const onComplete = vi.fn();
    api.runner.run({ steps: [{ type: "speak", text: "hi" }] });

    // If no voice, it falls back to subtitle bar (showSubtitle / wait), not commands.executeCommand
    // with the speakText command id
    // We just verify it doesn't call the voice command
    expect(commands.executeCommand).not.toHaveBeenCalledWith(
      "accordo.voice.speakText",
      expect.anything(),
    );
  });

  it("speakText dep present when voice extension is installed", () => {
    const bridge = makeBridge();
    setupBridge(bridge);
    setupVoiceInstalled(true);

    const ctx = createExtensionContextMock();
    activate(ctx);

    // Voice is installed, so the runner should wire speakText dep
    expect(extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-voice");
  });
});

// ── M52-EXT-07: openAndHighlight wiring ──────────────────────────────────────

describe("M52-EXT-07 openAndHighlight wiring", () => {
  it("highlight step calls workspace.openTextDocument and window.showTextDocument", async () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();
    const api = activate(ctx);

    const onComplete = vi.fn();
    api.runner.run(
      { steps: [{ type: "highlight", file: "/mock/file.ts", startLine: 1, endLine: 5 }] },
      // @ts-expect-error — inject callbacks directly for test
      { onComplete },
    );

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 1000 });

    expect(workspace.openTextDocument).toHaveBeenCalled();
    expect(window.showTextDocument).toHaveBeenCalled();
  });
});

// ── M52-EXT-12: graceful degradation (no bridge) ─────────────────────────────

describe("M52-EXT-12 graceful degradation without bridge", () => {
  it("activate does not throw when bridge is unavailable", () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();
    expect(() => activate(ctx)).not.toThrow();
  });

  it("commands are still registered even without bridge", () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();
    activate(ctx);

    const registeredNames = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls
      .map(([name]) => name as string);
    expect(registeredNames).toContain("accordo.script.stop");
  });
});

// ── M52-EXT-10: bridge tool registration ─────────────────────────────────────

describe("M52-EXT-10 tool registration via bridge", () => {
  it("registers exactly 4 script tools via bridge.registerTools", () => {
    const bridge = makeBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();
    activate(ctx);

    expect(bridge.registerTools).toHaveBeenCalledOnce();
    const [extensionId, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(extensionId).toBe("accordo.accordo-script");
    expect(tools).toHaveLength(4);
  });

  it("registered tool names include run, stop, status", () => {
    const bridge = makeBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();
    activate(ctx);

    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    const names = (tools as Array<{ name: string }>).map(t => t.name);
    expect(names).toContain("accordo_script_run");
    expect(names).toContain("accordo_script_stop");
    expect(names).toContain("accordo_script_status");
    expect(names).toContain("accordo_script_discover");
  });
});

// ── M52-EXT-11: state publishing ─────────────────────────────────────────────

describe("M52-EXT-11 state publishing to bridge", () => {
  it("publishes state on step complete", async () => {
    const bridge = makeBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();
    const api = activate(ctx);

    api.runner.run({ steps: [{ type: "clear-highlights" }] });
    await vi.waitFor(() => expect(bridge.publishState).toHaveBeenCalled(), { timeout: 1000 });

    const [extId, state] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(extId).toBe("accordo.accordo-script");
    expect(state).toHaveProperty("state");
  });
});

// ── M52-EXT-13: deactivate ────────────────────────────────────────────────────

describe("M52-EXT-13 deactivate", () => {
  it("deactivate does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
