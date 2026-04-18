/**
 * M50-EXT — extension.ts tests (simplified for TTS-only)
 * Coverage: M50-EXT-01 through M50-EXT-18 (simplified)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  activate,
  deactivate,
  type BridgeAPI,
  type VoiceActivateDeps,
} from "../extension.js";
import { extensions, commands, createExtensionContextMock } from "./mocks/vscode.js";
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
    ttsProvider: makeTtsProvider(true),
  };
}

function makeUnavailableDeps(): VoiceActivateDeps {
  return {
    ttsProvider: makeTtsProvider(false),
  };
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Exports ─────────────────────────────────────────────────────────────────

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
  it("registers exactly 1 voice MCP tool via bridge.registerTools (readAloud only)", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());

    expect(bridge.registerTools).toHaveBeenCalledOnce();
    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tools).toHaveLength(1);
  });

  it("registered tool name is accordo_voice_readAloud", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());

    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain("accordo_voice_readAloud");
  });
});

// ── M50-EXT-10: Command registration ──────────────────────────────────────────

describe("M50-EXT-10 Command registration", () => {
  it("registers accordo.voice.readAloud and accordo.voice.stopNarration", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: [string]) => call[0],
    );
    const voiceCmds = registeredCmds.filter((n: string) => n.startsWith("accordo.voice."));
    expect(voiceCmds).toContain("accordo.voice.readAloud");
    expect(voiceCmds).toContain("accordo.voice.stopNarration");
    // Minimal set: readAloud, stopNarration (no speakText in minimal mode)
  });
});

// ── M50-EXT-08/09: Availability check ────────────────────────────────────────

describe("M50-EXT-08/09 Provider availability", () => {
  it("M50-EXT-08: TTS available — activates without throwing", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());
    await new Promise(r => setImmediate(r));

    // Extension activates successfully with TTS available
    expect(bridge.publishState).toHaveBeenCalled();
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

  it("M50-EXT-14: published state includes policy and ttsAvailable", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const ctx = createExtensionContextMock();

    await activate(ctx, makeAvailableDeps());
    await new Promise(r => setImmediate(r));

    const [, state] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toHaveProperty("policy");
    expect(state).toHaveProperty("ttsAvailable");
  });
});

// ── M50-EXT-16: deactivate ──────────────────────────────────────────────────

describe("M50-EXT-16 deactivate", () => {
  it("deactivate() disposes TTS provider", async () => {
    const bridge = createMockBridge();
    setupBridge(bridge);
    const tts = makeTtsProvider(true);
    const ctx = createExtensionContextMock();

    await activate(ctx, { ttsProvider: tts });
    await deactivate();

    expect(tts.dispose).toHaveBeenCalled();
  });
});
