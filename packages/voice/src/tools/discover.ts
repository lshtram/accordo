/**
 * accordo_voice_discover — Discover available voice tools and current voice state.
 *
 * M50-DT
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import type { AudioFsm } from "../core/fsm/audio-fsm.js";
import type { NarrationFsm } from "../core/fsm/narration-fsm.js";
import type { SttProvider } from "../core/providers/stt-provider.js";
import type { TtsProvider } from "../core/providers/tts-provider.js";

export interface DiscoverToolDeps {
  sessionFsm: SessionFsm;
  audioFsm: AudioFsm;
  narrationFsm: NarrationFsm;
  sttProvider: SttProvider;
  ttsProvider: TtsProvider;
}

/** Available tools descriptor list — kept in sync with extension exports. */
const VOICE_TOOLS: Array<{ name: string; description: string }> = [
  {
    name: "accordo_voice_discover",
    description: "Discover available voice tools and current voice state",
  },
  {
    name: "accordo_voice_readAloud",
    description: "Read text aloud using text-to-speech. Cleans markdown/code before speaking.",
  },
  {
    name: "accordo_voice_dictation",
    description: "Record audio and transcribe speech-to-text. Returns the transcript.",
  },
  {
    name: "accordo_voice_setPolicy",
    description: "Update voice policy: enable/disable, narration mode, speed, voice, language",
  },
];

/** M50-DT */
export function createDiscoverTool(deps: DiscoverToolDeps): ExtensionToolDefinition {
  const { sessionFsm, audioFsm, narrationFsm, sttProvider, ttsProvider } = deps;

  return {
    name: "accordo_voice_discover",
    description: "Discover available voice tools and current voice state",
    group: "voice",
    dangerLevel: "safe",
    idempotent: true,
    inputSchema: { type: "object", properties: {} },
    handler: async (_args: Record<string, unknown>) => {
      const [sttAvailable, ttsAvailable] = await Promise.all([
        sttProvider.isAvailable(),
        ttsProvider.isAvailable(),
      ]);

      return {
        tools: VOICE_TOOLS,
        sessionState: sessionFsm.state,
        audioState: audioFsm.state,
        narrationState: narrationFsm.state,
        policy: sessionFsm.policy,
        sttAvailable,
        ttsAvailable,
      };
    },
  };
}
