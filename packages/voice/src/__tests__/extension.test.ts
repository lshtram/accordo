/**
 * M50-EXT — extension.ts tests (Phase B — must FAIL before implementation)
 * Coverage: M50-EXT-01 through M50-EXT-18
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  activate,
  deactivate,
  type BridgeAPI,
  type VoiceActivateDeps,
} from "../extension.js";
import { extensions, workspace, window, commands, createExtensionContextMock } from "./mocks/vscode.js";
import type { SttProvider } from "../core/providers/stt-provider.js";
import type { TtsProvider } from "../core/providers/tts-provider.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockBridge(): BridgeAPI {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
  };
}

function setupBridge(bridge: BridgeAPI | undefined): void {
  (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(
    bridge ? { exports: bridge, isActive: true } : undefined,
  );
}

function makeSttProvider(available = true): SttProvider {
  return {
    kind: "stt" as const,
    id: "mock-stt",
    isAvailable: vi.fn().mockResolvedValue(available),
    transcribe: vi.fn(),
  } as unknown as SttProvider;
}

function makeTtsProvider(available = true): TtsProvider {
  return {
    kind: "tts" as const,
    id: "mock-tts",
    isAvailable: vi.fn().mockResolvedValue(available),
    synthesize: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as TtsProvider;
}

function makeAvailableDeps(): VoiceActivateDeps {
  return {
    sttProvider: makeSttProvider(true),
    ttsProvider: makeTtsProvider(true),
  };
}

function makeUnavailableDeps(): VoiceActivateDeps {
  return {
    sttProvider: makeSttProvider(false),
    ttsProvider: makeTtsProvider(false),
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Exports ──────────────────────────────────────────────────────────────────

describe("M50-EXT exports", () => {
  it("M50-EXT-00: activate is exported as a function", () => {
    expect(typeof activate).toBe("function");
  });

  it("M50-EXT-00: deactivate is exported as a function", () => {
    expect(typeof deactivate).toBe("function");
  });
});

// ── M50-EXT-11: Bridge acquisition ──────────────────────────────────────────

describe("M50-EXT-11 Bridge acquisition", () => {
  it("acquires BridgeAPI from accordo.accordo-bridge", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());

    expect(extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-bridge");
  });

  it("M50-EXT-18: inert when bridge is absent — no throw", async () => {
    setupBridge(undefined);
    const ctx = createExtensionContextMock();

    await expect(activate(ctx, makeAvailableDeps())).resolves.not.toThrow();
  });
});

// ── M50-EXT-12: Tool registration ───────────────────────────────────────────

describe("M50-EXT-12 Tool registration", () => {
  it("registers exactly 4 voice MCP tools via bridge.registerTools", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());

    expect(bridge.registerTools).toHaveBeenCalledOnce();
    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tools).toHaveLength(4);
  });

  it("registered tools include all expected names", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());

    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain("accordo_voice_discover");
    expect(names).toContain("accordo_voice_readAloud");
    expect(names).toContain("accordo_voice_dictation");
    expect(names).toContain("accordo_voice_setPolicy");
  });
});

// ── M50-EXT-05/06: UI registration ──────────────────────────────────────────

describe("M50-EXT-05/06 UI setup", () => {
  it("M50-EXT-05: registers webview view provider for 'accordo-voice-panel'", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());

    expect(window.registerWebviewViewProvider).toHaveBeenCalledWith(
      "accordo-voice-panel",
      expect.anything(),
    );
  });

  it("M50-EXT-06: creates a StatusBarItem (window.createStatusBarItem called)", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());

    expect(window.createStatusBarItem).toHaveBeenCalled();
  });
});

// ── M50-EXT-10: Command registration ──────────────────────────────────────────

describe("M50-EXT-10 Command registration", () => {
  it("registers at least 5 voice commands", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]: [string]) => name,
    );
    const voiceCmds = registeredCmds.filter((n: string) => n.startsWith("accordo.voice."));
    expect(voiceCmds.length).toBeGreaterThanOrEqual(5);
  });
});

// ── M50-EXT-08/09: Availability check ────────────────────────────────────────

describe("M50-EXT-08/09 Provider availability", () => {
  it("M50-EXT-08: providers available — no warning shown", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());
    // Allow async availability check to run
    await new Promise(r => setImmediate(r));

    expect(window.showWarningMessage).not.toHaveBeenCalled();
  });

  it("M50-EXT-09: providers unavailable — shows warning message", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeUnavailableDeps());
    await new Promise(r => setImmediate(r));

    expect(window.showWarningMessage).toHaveBeenCalled();
  });
});

// ── M50-EXT-13/14: State publication ─────────────────────────────────────────

describe("M50-EXT-13/14 State publication", () => {
  it("M50-EXT-13: publishes initial voice state via bridge.publishState", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());
    await new Promise(r => setImmediate(r));

    expect(bridge.publishState).toHaveBeenCalled();
  });

  it("M50-EXT-14: published state includes required fields", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());
    await new Promise(r => setImmediate(r));

    const [, state] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toHaveProperty("session");
    expect(state).toHaveProperty("narration");
    expect(state).toHaveProperty("audio");
    expect(state).toHaveProperty("policy");
  });
});

// ── M50-EXT-16: deactivate ───────────────────────────────────────────────────

describe("M50-EXT-16 deactivate", () => {
  it("deactivate() disposes TTS provider", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const tts = makeTtsProvider(true);
    const ctx = createExtensionContextMock();

    await activate(ctx, { sttProvider: makeSttProvider(), ttsProvider: tts });
    await deactivate();

    expect(tts.dispose).toHaveBeenCalled();
  });
});
