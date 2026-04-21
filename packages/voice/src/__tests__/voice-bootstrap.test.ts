import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import type { TtsProvider } from "../core/providers/tts-provider.js";
import { loadPolicyFromConfiguration, publishVoiceState, syncUiAndState } from "../voice-bootstrap.js";
import { commands, workspace } from "./mocks/vscode.js";

function makeSessionFsm(): SessionFsm {
  return {
    policy: {
      enabled: true,
      narrationMode: "narrate-everything",
      speed: 1.2,
      voice: "af_sarah",
      language: "en-US",
    },
    updatePolicy: vi.fn(),
  } as unknown as SessionFsm;
}

describe("voice-bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loadPolicyFromConfiguration reads accordo.voice settings", () => {
    const sessionFsm = makeSessionFsm();

    workspace._mockConfig.set("accordo.voice.enabled", true);
    workspace._mockConfig.set("accordo.voice.voice", "af_bella");
    workspace._mockConfig.set("accordo.voice.speed", 1.5);
    workspace._mockConfig.set("accordo.voice.language", "fr-FR");
    workspace._mockConfig.set("accordo.voice.narrationMode", "narrate-summary");

    loadPolicyFromConfiguration(sessionFsm);

    expect(sessionFsm.updatePolicy).toHaveBeenCalledWith({
      enabled: true,
      voice: "af_bella",
      speed: 1.5,
      language: "fr-FR",
      narrationMode: "narrate-summary",
    });
  });

  it("publishVoiceState publishes policy and ttsAvailable", () => {
    const bridge = { publishState: vi.fn() };
    const sessionFsm = makeSessionFsm();

    publishVoiceState(bridge, sessionFsm, true);

    expect(bridge.publishState).toHaveBeenCalledWith("accordo-voice", {
      policy: sessionFsm.policy,
      ttsAvailable: true,
    });
  });

  it("syncUiAndState sets context key and publishes bridge state", async () => {
    const bridge = { publishState: vi.fn() };
    const sessionFsm = makeSessionFsm();
    const narrationFsm = { state: "playing" };
    const ttsProvider = { isAvailable: vi.fn().mockResolvedValue(true) } as unknown as TtsProvider;

    syncUiAndState(sessionFsm, narrationFsm, bridge, ttsProvider);
    await Promise.resolve();

    expect(commands.executeCommand).toHaveBeenCalledWith("setContext", "accordo.voice.narrating", true);
    expect(bridge.publishState).toHaveBeenCalledWith("accordo-voice", {
      policy: sessionFsm.policy,
      ttsAvailable: true,
    });
  });
});
