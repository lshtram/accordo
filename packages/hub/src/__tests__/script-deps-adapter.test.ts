/**
 * Tests for script-deps-adapter.ts
 * Requirements: M52-ADAPT — Script deps adapter
 * DEC-007 — throw-on-failure wrapping
 *
 * Tests the factory that creates a ScriptRunnerDeps wired to
 * bridgeServer.invoke(). Every dependency method wraps invoke()
 * with throw-on-failure semantics.
 *
 * Test plan items covered:
 * 1. executeCommand calls bridgeServer.invoke(cmd, args, timeout) and returns result on success
 * 2. executeCommand throws when result.success === false
 * 3. executeCommand re-throws transport errors from bridgeServer.invoke()
 * 4. executeCommand passes args as-is (or {} if undefined)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ResultMessage } from "@accordo/bridge-types";
import { createScriptDepsAdapter } from "../script/script-deps-adapter.js";
import type { ScriptRunnerDeps } from "../script/script-runner.js";
import type { BridgeServer } from "../bridge-server.js";

// ── Mock BridgeServer ────────────────────────────────────────────────────────

function makeMockBridgeServer(): BridgeServer {
  return {
    invoke: vi.fn<(tool: string, args: Record<string, unknown>, timeout: number) => Promise<ResultMessage>>(),
    isConnected: vi.fn().mockReturnValue(true),
  } as unknown as BridgeServer;
}

function successResult(data: unknown): ResultMessage {
  return { type: "result", id: "r1", success: true, data };
}

function failureResult(error: string): ResultMessage {
  return { type: "result", id: "r1", success: false, error };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createScriptDepsAdapter", () => {
  let bridge: BridgeServer;
  let deps: ScriptRunnerDeps;

  beforeEach(() => {
    bridge = makeMockBridgeServer();
    deps = createScriptDepsAdapter(bridge);
  });

  // ── executeCommand ───────────────────────────────────────────────────────

  describe("executeCommand", () => {
    it("M52-ADAPT: calls bridgeServer.invoke() with command name and args", async () => {
      vi.mocked(bridge.invoke).mockResolvedValue(successResult({ ok: true }));

      await deps.executeCommand("accordo_editor_open", { path: "/foo.ts" });

      expect(bridge.invoke).toHaveBeenCalledTimes(1);
      const [tool, args] = vi.mocked(bridge.invoke).mock.calls[0];
      expect(tool).toBe("accordo_editor_open");
      expect(args).toEqual({ path: "/foo.ts" });
    });

    it("M52-ADAPT: returns the data from a successful invoke result", async () => {
      vi.mocked(bridge.invoke).mockResolvedValue(successResult({ opened: true }));

      const result = await deps.executeCommand("accordo_editor_open", { path: "/foo.ts" });

      expect(result).toEqual({ opened: true });
    });

    it("DEC-007: throws when result.success === false", async () => {
      vi.mocked(bridge.invoke).mockResolvedValue(failureResult("No active editor"));

      await expect(
        deps.executeCommand("accordo_editor_close"),
      ).rejects.toThrow(/No active editor/);
    });

    it("DEC-007: re-throws transport errors from bridgeServer.invoke()", async () => {
      vi.mocked(bridge.invoke).mockRejectedValue(new Error("Bridge not connected"));

      await expect(
        deps.executeCommand("accordo_editor_open", { path: "/x" }),
      ).rejects.toThrow("Bridge not connected");
    });

    it("M52-ADAPT: passes {} as args when args is undefined", async () => {
      vi.mocked(bridge.invoke).mockResolvedValue(successResult({}));

      await deps.executeCommand("accordo_editor_close");

      const [, args] = vi.mocked(bridge.invoke).mock.calls[0];
      expect(args).toEqual({});
    });

    it("M52-ADAPT: passes args as-is when args is a plain object", async () => {
      const customArgs = { path: "/a.ts", line: 42 };
      vi.mocked(bridge.invoke).mockResolvedValue(successResult({}));

      await deps.executeCommand("accordo_editor_open", customArgs);

      const [, args] = vi.mocked(bridge.invoke).mock.calls[0];
      expect(args).toEqual(customArgs);
    });

    it("M52-ADAPT: uses a timeout for bridge invocation", async () => {
      vi.mocked(bridge.invoke).mockResolvedValue(successResult({}));

      await deps.executeCommand("accordo_editor_open", { path: "/foo.ts" });

      // Third argument to invoke() is the timeout — must be a positive number
      const timeout = vi.mocked(bridge.invoke).mock.calls[0][2];
      expect(typeof timeout).toBe("number");
      expect(timeout).toBeGreaterThan(0);
    });
  });

  // ── speakText ────────────────────────────────────────────────────────────

  describe("speakText", () => {
    it("M52-ADAPT: speakText is defined as a function", () => {
      expect(typeof deps.speakText).toBe("function");
    });

    it("M52-ADAPT: speakText calls bridgeServer.invoke with voice tool", async () => {
      vi.mocked(bridge.invoke).mockResolvedValue(successResult({}));

      await deps.speakText!("Hello world", { block: true });

      expect(bridge.invoke).toHaveBeenCalledTimes(1);
      const [tool] = vi.mocked(bridge.invoke).mock.calls[0];
      expect(tool).toMatch(/voice|speak/i);
    });
  });

  // ── showSubtitle ─────────────────────────────────────────────────────────

  describe("showSubtitle", () => {
    it("M52-ADAPT: showSubtitle is defined as a function", () => {
      expect(typeof deps.showSubtitle).toBe("function");
    });

    it("M52-ADAPT: showSubtitle calls bridgeServer.invoke with subtitle tool", () => {
      // showSubtitle is sync in the ScriptRunnerDeps interface — it fires and forgets.
      // DEC-008 (Option A): Under the hood it calls bridgeServer.invoke() but does
      // not await the result in the synchronous return.
      vi.mocked(bridge.invoke).mockResolvedValue(successResult({ shown: true }));

      deps.showSubtitle("Hello", 3000);

      expect(bridge.invoke).toHaveBeenCalledTimes(1);
      const [tool, args] = vi.mocked(bridge.invoke).mock.calls[0];
      expect(tool).toBe("accordo_subtitle_show");
      expect(args).toEqual(expect.objectContaining({ text: "Hello", durationMs: 3000 }));
    });
  });

  // ── openAndHighlight ────────────────────────────────────────────────────

  describe("openAndHighlight", () => {
    it("M52-ADAPT: openAndHighlight calls bridgeServer.invoke", async () => {
      vi.mocked(bridge.invoke).mockResolvedValue(successResult({}));

      await deps.openAndHighlight("src/foo.ts", 10, 20);

      expect(bridge.invoke).toHaveBeenCalled();
    });

    it("M52-ADAPT: openAndHighlight throws on failure", async () => {
      vi.mocked(bridge.invoke).mockResolvedValue(failureResult("File not found"));

      await expect(
        deps.openAndHighlight("missing.ts", 1, 5),
      ).rejects.toThrow(/File not found/);
    });
  });

  // ── clearHighlights ──────────────────────────────────────────────────────

  describe("clearHighlights", () => {
    it("M52-ADAPT: clearHighlights calls bridgeServer.invoke", () => {
      vi.mocked(bridge.invoke).mockResolvedValue(successResult({}));

      deps.clearHighlights();

      expect(bridge.invoke).toHaveBeenCalledTimes(1);
    });
  });

  // ── wait ──────────────────────────────────────────────────────────────────

  describe("wait", () => {
    it("M52-ADAPT: wait resolves after the specified ms", async () => {
      vi.useFakeTimers();

      const promise = deps.wait(500);
      vi.advanceTimersByTime(500);
      await promise;

      // If we get here, wait resolved — that's the assertion
      expect(true).toBe(true);

      vi.useRealTimers();
    });

    it("M52-ADAPT: wait does NOT call bridgeServer.invoke (local timer)", async () => {
      vi.useFakeTimers();

      const promise = deps.wait(100);
      vi.advanceTimersByTime(100);
      await promise;

      expect(bridge.invoke).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
