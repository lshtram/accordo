/**
 * M52-EXT — extension.ts tests
 * Coverage: M52-EXT-01, M52-EXT-03 through M52-EXT-07, M52-EXT-10, M52-EXT-12, M52-EXT-13
 *
 * NOTE: M52-EXT-02 (bridge acquisition), M52-EXT-10 (Bridge tool registration),
 * and M52-EXT-11 (state publishing) have been removed. The 4 script tools
 * (accordo_script_run/stop/status/discover) are Hub-native tools registered in
 * packages/hub/src/server.ts. This extension must NOT register them via Bridge.
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

function setupVoiceInstalled(installed: boolean): void {
  (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
    (id: string) => {
      if (id === "accordo.accordo-voice") return installed ? { exports: {}, isActive: true } : undefined;
      return undefined;
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no extensions installed
  (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(undefined);
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
    const ctx = createExtensionContextMock();
    const api = activate(ctx);
    expect(api.runner).toBeDefined();
  });
});

// ── M52-EXT-10 (regression): no Bridge tool registration ─────────────────────
// The 4 script tools are Hub-native. Registering them via Bridge would create
// ghost tool entries (pointing to a runner that never runs scripts) in Hub's
// bridgeTools pool. See packages/hub/src/server.ts for the canonical registration.

describe("M52-EXT-10 no Bridge tool registration", () => {
  it("does NOT call bridge.registerTools (tools are Hub-native)", () => {
    const bridge = makeBridge();
    // Simulate bridge being available
    (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
      (id: string) => id === "accordo.accordo-bridge" ? { exports: bridge, isActive: true } : undefined,
    );
    const ctx = createExtensionContextMock();
    activate(ctx);

    expect(bridge.registerTools).not.toHaveBeenCalled();
  });
});

// ── M52-EXT-10b: accordo.script.stop command ─────────────────────────────────

describe("M52-EXT-10b accordo.script.stop command", () => {
  it("registers the accordo.script.stop VS Code command", () => {
    const ctx = createExtensionContextMock();
    activate(ctx);

    expect(commands.registerCommand).toHaveBeenCalledWith(
      "accordo.script.stop",
      expect.any(Function),
    );
  });

  it("calling accordo.script.stop calls runner.stop()", () => {
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
    const ctx = createExtensionContextMock();
    activate(ctx);
    expect(window.createStatusBarItem).toHaveBeenCalled();
  });
});

// ── M52-EXT-04: executeCommand wiring ────────────────────────────────────────

describe("M52-EXT-04 executeCommand wiring", () => {
  it("runner.deps.executeCommand calls vscode.commands.executeCommand", async () => {
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
    setupVoiceInstalled(false);
    const ctx = createExtensionContextMock();
    const api = activate(ctx);

    // Access internal deps — the runner should have been constructed without speakText
    // We verify indirectly: run a speak step and confirm commands.executeCommand
    //  is NOT called with accordo.voice.speakText
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
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
    const ctx = createExtensionContextMock();
    expect(() => activate(ctx)).not.toThrow();
  });

  it("accordo.script.stop is registered even without bridge", () => {
    const ctx = createExtensionContextMock();
    activate(ctx);

    const registeredNames = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls
      .map(([name]) => name as string);
    expect(registeredNames).toContain("accordo.script.stop");
  });
});

// ── M52-EXT-13: deactivate ────────────────────────────────────────────────────

describe("M52-EXT-13 deactivate", () => {
  it("deactivate does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
