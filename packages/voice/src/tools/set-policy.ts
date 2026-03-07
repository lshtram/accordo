/**
 * accordo_voice_setPolicy — Update voice policy.
 *
 * M50-POL
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import { type VoicePolicy, type NarrationMode, NARRATION_MODES } from "../core/fsm/types.js";
import * as vscode from "vscode";

export type ConfigUpdateFn = (
  key: string,
  value: unknown,
  target?: vscode.ConfigurationTarget,
) => Thenable<void>;

export interface SetPolicyToolDeps {
  sessionFsm: SessionFsm;
  updateConfig?: ConfigUpdateFn;
}

/** M50-POL */
export function createSetPolicyTool(deps: SetPolicyToolDeps): ExtensionToolDefinition {
  const { sessionFsm, updateConfig } = deps;

  return {
    name: "accordo_voice_setPolicy",
    description: "Update voice policy: enable/disable, narration mode, speed, voice, language",
    group: "voice",
    dangerLevel: "safe",
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "Enable or disable the voice session" },
        narrationMode: {
          type: "string",
          enum: [...NARRATION_MODES],
          description: "Narration mode",
        },
        speed: { type: "number", description: "Playback speed multiplier (0.5–2.0)" },
        voice: { type: "string", description: "Voice identifier" },
        language: { type: "string", description: "BCP-47 language code" },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      const { enabled, narrationMode, speed, voice, language } = args as {
        enabled?: boolean;
        narrationMode?: string;
        speed?: number;
        voice?: string;
        language?: string;
      };

      // ── Validation ──────────────────────────────────────────────────────

      if (speed !== undefined && (speed < 0.5 || speed > 2.0)) {
        return { error: `speed must be between 0.5 and 2.0, got ${speed}` };
      }

      if (
        narrationMode !== undefined &&
        !(NARRATION_MODES as readonly string[]).includes(narrationMode)
      ) {
        return { error: `Invalid narrationMode: ${narrationMode}` };
      }

      if (voice !== undefined && voice.trim() === "") {
        return { error: "voice must not be empty" };
      }

      // ── Apply enabled ────────────────────────────────────────────────────

      if (enabled === true) {
        sessionFsm.enable();
      } else if (enabled === false) {
        sessionFsm.disable();
      }

      // ── Build partial policy ─────────────────────────────────────────────

      const partial: Partial<VoicePolicy> = {};
      if (enabled !== undefined) partial.enabled = enabled;
      if (narrationMode !== undefined) partial.narrationMode = narrationMode as NarrationMode;
      if (speed !== undefined) partial.speed = speed;
      if (voice !== undefined) partial.voice = voice;
      if (language !== undefined) partial.language = language;

      if (Object.keys(partial).length > 0) {
        sessionFsm.updatePolicy(partial);
      }

      // ── Persist to VS Code settings ──────────────────────────────────────

      if (updateConfig) {
        const target = vscode.ConfigurationTarget.Global;
        const cfgUpdates: Array<Promise<void>> = [];
        if (enabled !== undefined)
          cfgUpdates.push(Promise.resolve(updateConfig("accordo.voice.enabled", enabled, target)));
        if (narrationMode !== undefined)
          cfgUpdates.push(
            Promise.resolve(updateConfig("accordo.voice.narrationMode", narrationMode, target)),
          );
        if (speed !== undefined)
          cfgUpdates.push(
            Promise.resolve(updateConfig("accordo.voice.speed", speed, target)),
          );
        if (voice !== undefined)
          cfgUpdates.push(
            Promise.resolve(updateConfig("accordo.voice.voice", voice, target)),
          );
        if (language !== undefined)
          cfgUpdates.push(
            Promise.resolve(updateConfig("accordo.voice.language", language, target)),
          );
        await Promise.all(cfgUpdates);
      }

      return { policy: sessionFsm.policy };
    },
  };
}
