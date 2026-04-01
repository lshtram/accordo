/**
 * script-deps-adapter.ts
 *
 * Factory that creates a ScriptRunnerDeps wired to the Hub's BridgeServer.
 * Each dependency method wraps bridgeServer.invoke() with throw-on-failure
 * semantics, preserving the ScriptRunner's error handling contract.
 *
 * DEC-005 — Hub-native tool local handler pattern
 * DEC-007 — Script deps adapter: throw-on-failure wrapping
 * DEC-008 — showSubtitle fire-and-forget via Bridge invoke
 */

import type { BridgeServer } from "../bridge-server.js";
import type { ScriptRunnerDeps } from "./script-runner.js";

/**
 * Default timeout for script dep bridge invocations (ms).
 * Individual tools may need longer (e.g. speak with long text).
 */
const SCRIPT_DEP_TIMEOUT = 30_000;

/**
 * Call bridgeServer.invoke and throw on failure.
 * DEC-007: preserves the ScriptRunner's error handling contract —
 * every dep method that fails throws, so errPolicy ("abort"|"skip") works.
 */
async function invokeOrThrow(
  bridgeServer: BridgeServer,
  tool: string,
  args: Record<string, unknown>,
  timeout: number = SCRIPT_DEP_TIMEOUT,
): Promise<unknown> {
  const result = await bridgeServer.invoke(tool, args, timeout);
  if (!result.success) {
    throw new Error(result.error ?? "Tool call failed");
  }
  return result.data;
}

/**
 * Create a ScriptRunnerDeps that routes all operations through
 * bridgeServer.invoke(). Throws on failure (preserves errPolicy logic
 * in ScriptRunner).
 *
 * @param bridgeServer - The Hub's BridgeServer instance for routing calls
 * @returns A ScriptRunnerDeps wired to the bridge
 */
export function createScriptDepsAdapter(
  bridgeServer: BridgeServer,
): ScriptRunnerDeps {
  return {
    executeCommand: async (command: string, args?: unknown): Promise<unknown> => {
      const invokeArgs = (args !== undefined && args !== null && typeof args === "object")
        ? args as Record<string, unknown>
        : {};
      return invokeOrThrow(bridgeServer, command, invokeArgs, SCRIPT_DEP_TIMEOUT);
    },

    speakText: async (text: string, opts: { voice?: string; speed?: number; block: boolean }): Promise<void> => {
      const args: Record<string, unknown> = { text };
      if (opts.voice !== undefined) args.voice = opts.voice;
      if (opts.speed !== undefined) args.speed = opts.speed;
      args.block = opts.block;
      await invokeOrThrow(bridgeServer, "accordo_voice_readAloud", args, SCRIPT_DEP_TIMEOUT);
    },

    // DEC-008 (Option A): showSubtitle is synchronous in the ScriptRunnerDeps
    // interface. We fire bridgeServer.invoke() but do NOT await it — the
    // promise is intentionally detached (fire-and-forget). Errors are caught and
    // logged rather than propagated since the caller (ScriptRunner) cannot act on them.
    showSubtitle: (text: string, durationMs: number): void => {
      void bridgeServer
        .invoke("accordo_subtitle_show", { text, durationMs }, SCRIPT_DEP_TIMEOUT)
        .catch(() => {
          // Swallow errors — subtitle display is best-effort and non-critical.
          // The script continues regardless.
        });
    },

    openAndHighlight: async (file: string, startLine: number, endLine: number): Promise<void> => {
      await invokeOrThrow(
        bridgeServer,
        "accordo_editor_highlight",
        { path: file, startLine, endLine },
        SCRIPT_DEP_TIMEOUT,
      );
    },

    // clearHighlights is synchronous in the interface — fire-and-forget.
    clearHighlights: (): void => {
      void bridgeServer.invoke(
        "accordo_editor_clearHighlights",
        {},
        SCRIPT_DEP_TIMEOUT,
      );
    },

    // wait is a local timer — no Bridge call needed.
    wait: (ms: number): Promise<void> => {
      return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    },
  };
}
