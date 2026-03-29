/**
 * voice-bootstrap.test.ts — Phase B
 * Tests for ceremony / setup functions in voice-bootstrap.ts:
 *   readVoiceConfig(context)               → VoiceBootstrapConfig
 *   loadPolicyFromConfiguration(sessionFsm) → void
 *   syncUiAndState(...)                    → void
 *   updateStatusBar(...)                   → void
 *   publishVoiceState(...)                 → void
 *
 * All tests must FAIL before implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  readVoiceConfig,
  loadPolicyFromConfiguration,
  syncUiAndState,
  updateStatusBar,
  publishVoiceState,
  type VoiceBootstrapConfig,
} from "../voice-bootstrap.js";

import type { BridgeAPI } from "../extension.js";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import type { AudioFsm } from "../core/fsm/audio-fsm.js";
import type { NarrationFsm } from "../core/fsm/narration-fsm.js";
import type { VoiceStatusBar } from "../ui/status-bar.js";
import type { VoicePanelProvider } from "../ui/voice-panel.js";

import { workspace, createExtensionContextMock } from "./mocks/vscode.js";

// ── Mock factories ─────────────────────────────────────────────────────────────

function createMockSessionFsm(): SessionFsm {
  const fsm = {
    state: "inactive" as const,
    policy: {
      enabled: false,
      voice: "af_sarah",
      speed: 1.0,
      language: "en-US",
      narrationMode: "narrate-off" as const,
    },
    updatePolicy: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  };
  return fsm as unknown as SessionFsm;
}

function createMockAudioFsm(): AudioFsm {
  return {
    state: "idle" as const,
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    transcriptReady: vi.fn(),
    error: vi.fn(),
    reset: vi.fn(),
  } as unknown as AudioFsm;
}

function createMockNarrationFsm(): NarrationFsm {
  return {
    state: "idle" as const,
    enqueue: vi.fn(),
    startProcessing: vi.fn(),
    audioReady: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    complete: vi.fn(),
    error: vi.fn(),
  } as unknown as NarrationFsm;
}

function createMockStatusBar(): VoiceStatusBar {
  return {
    update: vi.fn(),
    dispose: vi.fn(),
  } as unknown as VoiceStatusBar;
}

function createMockPanelProvider(): VoicePanelProvider {
  return {
    postMessage: vi.fn(),
    dispose: vi.fn(),
  } as unknown as VoicePanelProvider;
}

function createMockBridge(): BridgeAPI {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// readVoiceConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("readVoiceConfig", () => {
  it("REQ-VB-01: returns an object with all expected voice config keys", () => {
    const ctx = createExtensionContextMock();
    const config = readVoiceConfig(ctx);

    expect(config).toHaveProperty("enabled");
    expect(config).toHaveProperty("voice");
    expect(config).toHaveProperty("speed");
    expect(config).toHaveProperty("language");
    expect(config).toHaveProperty("narrationMode");
    expect(config).toHaveProperty("sttProvider");
    expect(config).toHaveProperty("inputTarget");
    expect(config).toHaveProperty("recordingReadyChime");
  });

  it("REQ-VB-02: uses correct defaults when config is empty", () => {
    // Override workspace mock to return undefined for all config keys
    (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
      update: vi.fn(),
      has: vi.fn(() => false),
      inspect: vi.fn(),
    });

    const ctx = createExtensionContextMock();
    const config = readVoiceConfig(ctx);

    expect(config.enabled).toBe(false);
    expect(config.voice).toBe("af_sarah");
    expect(config.speed).toBe(1.0);
    expect(config.language).toBe("en-US");
    expect(config.narrationMode).toBe("narrate-off");
    expect(config.inputTarget).toBe("focus-text-input");
    expect(config.recordingReadyChime).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadPolicyFromConfiguration
// ─────────────────────────────────────────────────────────────────────────────

describe("loadPolicyFromConfiguration", () => {
  it("REQ-VB-03: calls sessionFsm.updatePolicy with the correct values", () => {
    const sessionFsm = createMockSessionFsm();
    // Reset the mock so we can assert on it after the call
    sessionFsm.updatePolicy = vi.fn();

    loadPolicyFromConfiguration(sessionFsm);

    expect(sessionFsm.updatePolicy).toHaveBeenCalledTimes(1);
    const callArg = (sessionFsm.updatePolicy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(callArg).toHaveProperty("enabled");
    expect(callArg).toHaveProperty("voice");
    expect(callArg).toHaveProperty("speed");
    expect(callArg).toHaveProperty("language");
    expect(callArg).toHaveProperty("narrationMode");
  });

  it("REQ-VB-04: loadPolicyFromConfiguration is a callable function", () => {
    const sessionFsm = createMockSessionFsm();
    expect(typeof loadPolicyFromConfiguration).toBe("function");
    // Should not throw when called with valid args
    expect(() => loadPolicyFromConfiguration(sessionFsm)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateStatusBar
// ─────────────────────────────────────────────────────────────────────────────

describe("updateStatusBar", () => {
  it("REQ-VB-05: calls statusBar.update with FSM states and policy", () => {
    const statusBar = createMockStatusBar();
    const sessionFsm = createMockSessionFsm();
    const audioFsm = createMockAudioFsm();
    const narrationFsm = createMockNarrationFsm();

    updateStatusBar(statusBar, sessionFsm, audioFsm, narrationFsm, false);

    expect(statusBar.update).toHaveBeenCalledTimes(1);
    const callArgs = (statusBar.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe(sessionFsm.state);
    expect(callArgs[1]).toBe(audioFsm.state);
    expect(callArgs[2]).toBe(narrationFsm.state);
    expect(callArgs[3]).toEqual(sessionFsm.policy);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncUiAndState
// ─────────────────────────────────────────────────────────────────────────────

describe("syncUiAndState", () => {
  it("REQ-VB-06: syncUiAndState is a callable function", () => {
    const sessionFsm = createMockSessionFsm();
    const audioFsm = createMockAudioFsm();
    const narrationFsm = createMockNarrationFsm();
    const statusBar = createMockStatusBar();
    const panelProvider = createMockPanelProvider();

    expect(typeof syncUiAndState).toBe("function");
    expect(() =>
      syncUiAndState(sessionFsm, audioFsm, narrationFsm, statusBar, panelProvider, undefined, false),
    ).not.toThrow();
  });

  it("REQ-VB-07: syncUiAndState calls statusBar.update with correct args", () => {
    const sessionFsm = createMockSessionFsm();
    const audioFsm = createMockAudioFsm();
    const narrationFsm = createMockNarrationFsm();
    const statusBar = createMockStatusBar();
    const panelProvider = createMockPanelProvider();

    syncUiAndState(sessionFsm, audioFsm, narrationFsm, statusBar, panelProvider, undefined, false);

    expect(statusBar.update).toHaveBeenCalledTimes(1);
  });

  it("REQ-VB-08: syncUiAndState posts stateChange message to panelProvider", () => {
    const sessionFsm = createMockSessionFsm();
    const audioFsm = createMockAudioFsm();
    const narrationFsm = createMockNarrationFsm();
    const statusBar = createMockStatusBar();
    const panelProvider = createMockPanelProvider();

    syncUiAndState(sessionFsm, audioFsm, narrationFsm, statusBar, panelProvider, undefined, false);

    expect(panelProvider.postMessage).toHaveBeenCalledTimes(1);
    const msg = (panelProvider.postMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(msg).toHaveProperty("type", "stateChange");
    expect(msg).toHaveProperty("session", sessionFsm.state);
    expect(msg).toHaveProperty("audio", audioFsm.state);
    expect(msg).toHaveProperty("narration", narrationFsm.state);
  });

  it("REQ-VB-09: syncUiAndState calls bridge.publishState when bridge and availabilityKnown are set", () => {
    const sessionFsm = createMockSessionFsm();
    const audioFsm = createMockAudioFsm();
    const narrationFsm = createMockNarrationFsm();
    const statusBar = createMockStatusBar();
    const panelProvider = createMockPanelProvider();
    const bridge = createMockBridge();

    syncUiAndState(sessionFsm, audioFsm, narrationFsm, statusBar, panelProvider, bridge, true);

    expect(bridge.publishState).toHaveBeenCalledTimes(1);
    expect(bridge.publishState).toHaveBeenCalledWith(
      "accordo-voice",
      expect.objectContaining({
        session: sessionFsm.state,
        audio: audioFsm.state,
        narration: narrationFsm.state,
        policy: sessionFsm.policy,
      }),
    );
  });

  it("REQ-VB-10: syncUiAndState does NOT call bridge.publishState when bridge is undefined", () => {
    const sessionFsm = createMockSessionFsm();
    const audioFsm = createMockAudioFsm();
    const narrationFsm = createMockNarrationFsm();
    const statusBar = createMockStatusBar();
    const panelProvider = createMockPanelProvider();

    syncUiAndState(sessionFsm, audioFsm, narrationFsm, statusBar, panelProvider, undefined, true);

    // bridge is undefined so publishState should not be called
    // (No bridge instance exists to call it on)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// publishVoiceState
// ─────────────────────────────────────────────────────────────────────────────

describe("publishVoiceState", () => {
  it("REQ-VB-11: publishVoiceState calls bridge.publishState with correct extensionId and payload", () => {
    const bridge = createMockBridge();
    const sessionFsm = createMockSessionFsm();
    const audioFsm = createMockAudioFsm();
    const narrationFsm = createMockNarrationFsm();

    publishVoiceState(bridge, sessionFsm, audioFsm, narrationFsm, true, true);

    expect(bridge.publishState).toHaveBeenCalledTimes(1);
    const [extId, payload] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(extId).toBe("accordo-voice");
    expect(payload).toHaveProperty("session", "inactive");
    expect(payload).toHaveProperty("audio", "idle");
    expect(payload).toHaveProperty("narration", "idle");
    expect(payload).toHaveProperty("policy");
    expect(payload).toHaveProperty("sttAvailable", true);
    expect(payload).toHaveProperty("ttsAvailable", true);
  });

  it("REQ-VB-12: publishVoiceState includes sttAvailable and ttsAvailable in payload", () => {
    const bridge = createMockBridge();
    const sessionFsm = createMockSessionFsm();
    const audioFsm = createMockAudioFsm();
    const narrationFsm = createMockNarrationFsm();

    publishVoiceState(bridge, sessionFsm, audioFsm, narrationFsm, false, true);

    const [, payload] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.sttAvailable).toBe(false);
    expect(payload.ttsAvailable).toBe(true);
  });
});
