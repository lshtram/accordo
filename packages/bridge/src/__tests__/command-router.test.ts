/**
 * Tests for command-router.ts
 * Requirements: requirements-bridge.md §5.2
 *
 * Phase B state: handleInvoke() and handleCancel() throw 'not implemented'.
 * handleInvoke() tests FAIL as expected. cancelAll() and getInflightCount() work.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CommandRouter } from "../command-router.js";
import type { ConfirmationDialogFn, SendResultFn, SendCancelledFn } from "../command-router.js";
import type { ExtensionRegistry } from "../extension-registry.js";
import type { InvokeMessage, CancelMessage, ResultMessage, ToolRegistration } from "@accordo/bridge-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal ToolRegistration used for confirmation-policy tests */
const DEFAULT_TOOL: ToolRegistration = {
  name: "",
  description: "test tool",
  inputSchema: { type: "object", properties: {}, required: [] },
  dangerLevel: "safe",
  requiresConfirmation: false,
  idempotent: true,
};

/**
 * Build a mock ExtensionRegistry.
 * @param handlers - tool name → handler function
 * @param toolDefs - tool name → partial ToolRegistration override (e.g. {requiresConfirmation: true})
 */
function makeRegistry(
  handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {},
  toolDefs: Record<string, Partial<ToolRegistration>> = {},
): ExtensionRegistry {
  return {
    getHandler: (name: string) => handlers[name],
    registerTools: () => { throw new Error("not used in router tests"); },
    getTool: (name: string) =>
      name in toolDefs || name in handlers
        ? { ...DEFAULT_TOOL, name, ...toolDefs[name] }
        : undefined,
    getAllTools: () => [],
    setSendFunction: () => {},
    size: 0,
    dispose: () => {},
  } as unknown as ExtensionRegistry;
}

function makeInvoke(overrides: Partial<InvokeMessage> = {}): InvokeMessage {
  return {
    type: "invoke",
    id: "test-invoke-id",
    tool: "ext:myTool",
    args: {},
    timeout: 30_000,
    ...overrides,
  };
}

function makeCancel(id: string): CancelMessage {
  return { type: "cancel", id };
}

function makeRouter(opts: {
  handlers?: Record<string, (...args: unknown[]) => Promise<unknown>>;
  toolDefs?: Record<string, Partial<ToolRegistration>>;
  confirmationFn?: ConfirmationDialogFn;
  sendResultFn?: SendResultFn;
  sendCancelledFn?: SendCancelledFn;
} = {}): {
  router: CommandRouter;
  sendResultFn: SendResultFn;
  sendCancelledFn: SendCancelledFn;
  confirmationFn: ConfirmationDialogFn;
} {
  const sendResultFn: SendResultFn = opts.sendResultFn ?? vi.fn();
  const sendCancelledFn: SendCancelledFn = opts.sendCancelledFn ?? vi.fn();
  const confirmationFn: ConfirmationDialogFn = opts.confirmationFn ?? vi.fn(async () => true);
  const registry = makeRegistry(opts.handlers ?? {}, opts.toolDefs ?? {});
  const router = new CommandRouter(registry);
  router.setSendResultFn(sendResultFn);
  router.setSendCancelledFn(sendCancelledFn);
  router.setConfirmationFn(confirmationFn);
  return { router, sendResultFn, sendCancelledFn, confirmationFn };
}

// ── CommandRouter ─────────────────────────────────────────────────────────────

describe("CommandRouter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── construction ─────────────────────────────────────────────────────────

  describe("construction", () => {
    it("creates without throwing", () => {
      expect(() => makeRouter()).not.toThrow();
    });

    it("getInflightCount() returns 0 initially", () => {
      const { router } = makeRouter();
      expect(router.getInflightCount()).toBe(0);
    });
  });

  // ── handleInvoke — Step 1: tool not found ─────────────────────────────────

  describe("handleInvoke — Step 1: tool not found → error result", () => {
    it("Step 1: sends error ResultMessage when tool is not registered", async () => {
      const sendResultFn = vi.fn();
      const { router } = makeRouter({ handlers: {}, sendResultFn });
      await router.handleInvoke(makeInvoke({ tool: "missing:tool" }));
      expect(sendResultFn).toHaveBeenCalledWith(
        expect.objectContaining({ type: "result", success: false }),
      );
    });

    it("Step 1: error message includes the missing tool name", async () => {
      const results: ResultMessage[] = [];
      const sendResultFn = vi.fn((r: ResultMessage) => results.push(r));
      const { router } = makeRouter({ handlers: {}, sendResultFn });
      await router.handleInvoke(makeInvoke({ tool: "missing:tool" }));
      expect(results[0]?.error).toContain("missing:tool");
    });

    it("Step 1: preserves the invocation ID in the error result", async () => {
      const results: ResultMessage[] = [];
      const sendResultFn = vi.fn((r: ResultMessage) => results.push(r));
      const { router } = makeRouter({ handlers: {}, sendResultFn });
      await router.handleInvoke(makeInvoke({ id: "unique-99", tool: "no:tool" }));
      expect(results[0]?.id).toBe("unique-99");
    });
  });

  // ── handleInvoke — Step 2+3: confirmation dialog ──────────────────────────

  describe("handleInvoke — Steps 2–3: confirmation dialog", () => {
    it("Step 2: calls confirmationFn when tool has requiresConfirmation=true in registry", async () => {
      // RED on stub: handleInvoke throws before reaching confirmation check
      const confirmationFn = vi.fn(async () => true);
      const handler = vi.fn(async () => ({}));
      const { router } = makeRouter({
        handlers: { "ext:dangerous": handler },
        toolDefs: { "ext:dangerous": { requiresConfirmation: true } },
        confirmationFn,
      });
      await router.handleInvoke(makeInvoke({ tool: "ext:dangerous", args: { file: "x" } }));
      // After implementation: router must look up tool in registry and call confirmationFn
      expect(confirmationFn).toHaveBeenCalled();
    });

    it("Step 2: confirmationFn receives tool name and args", async () => {
      // RED on stub: handleInvoke throws
      const confirmationFn = vi.fn(async () => true);
      const handler = vi.fn(async () => ({}));
      const { router } = makeRouter({
        handlers: { "ext:dangerous": handler },
        toolDefs: { "ext:dangerous": { requiresConfirmation: true } },
        confirmationFn,
      });
      const args = { file: "important.ts" };
      await router.handleInvoke(makeInvoke({ tool: "ext:dangerous", args }));
      // After implementation: called with (toolName, args)
      expect(confirmationFn).toHaveBeenCalledWith("ext:dangerous", args);
    });

    it("Step 3: sends error result when user cancels confirmation (returns false)", async () => {
      // RED on stub: handleInvoke throws before confirmationFn is called
      const confirmationFn = vi.fn(async () => false);
      const handler = vi.fn(async () => ({}));
      const results: ResultMessage[] = [];
      const sendResultFn = vi.fn((r: ResultMessage) => results.push(r));
      const { router } = makeRouter({
        handlers: { "ext:dangerous": handler },
        toolDefs: { "ext:dangerous": { requiresConfirmation: true } },
        confirmationFn,
        sendResultFn,
      });
      await router.handleInvoke(makeInvoke({ tool: "ext:dangerous" }));
      // After implementation: confirmationFn returns false → error result with 'rejected'
      expect(results[0]).toMatchObject({ type: "result", success: false });
      expect(results[0]?.error).toMatch(/rejected/i);
    });

    it("Step 3: handler is NOT invoked when user rejects", async () => {
      // RED on stub: handleInvoke throws before handler call decision
      const confirmationFn = vi.fn(async () => false);
      const handler = vi.fn(async () => ({}));
      const { router } = makeRouter({
        handlers: { "ext:dangerous": handler },
        toolDefs: { "ext:dangerous": { requiresConfirmation: true } },
        confirmationFn,
      });
      await router.handleInvoke(makeInvoke({ tool: "ext:dangerous" }));
      // Handler must NOT have been called
      expect(handler).not.toHaveBeenCalled();
    });

    it("Step 3b: cancel in-flight → sendCancelledFn is called and handler's late result is discarded", async () => {
      // RED on stub: handleCancel throws → sendCancelledFn never called → assertion fails
      vi.useFakeTimers();
      let resolveHandler!: () => void;
      const handler = vi.fn(
        async () =>
          new Promise<{ done: boolean }>((resolve) => {
            resolveHandler = () => resolve({ done: true });
          }),
      );
      const sendResultFn = vi.fn();
      const sendCancelledFn = vi.fn();
      const { router } = makeRouter({
        handlers: { "ext:long": handler },
        sendResultFn,
        sendCancelledFn,
      });
      const invokeP = router.handleInvoke(
        makeInvoke({ id: "inflight-id", tool: "ext:long", timeout: 120_000 }),
      );
      // Suppress unhandled rejection from stub before synchronous throw below
      invokeP.catch(() => {});
      // Cancel before the handler finishes
      try { router.handleCancel(makeCancel("inflight-id")); } catch { /* stub */ }
      // Now let handler finish late
      resolveHandler?.();
      await invokeP.catch(() => {});
      // After implementation: cancel while in-flight → sendCancelledFn(id, late=false) is called
      expect(sendCancelledFn).toHaveBeenCalledWith("inflight-id", false);
      // The handler's late result must NOT trigger a sendResultFn call
      expect(sendResultFn).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // ── handleInvoke — Steps 5–7: successful execution ────────────────────────

  describe("handleInvoke — Steps 5–7: successful handler execution", () => {
    it("Steps 5–7: calls handler with args and sends success ResultMessage", async () => {
      const args = { query: "find todos" };
      const handlerResult = { files: ["a.ts", "b.ts"] };
      const handler = vi.fn(async () => handlerResult);
      const results: ResultMessage[] = [];
      const sendResultFn = vi.fn((r: ResultMessage) => results.push(r));
      const { router } = makeRouter({ handlers: { "ext:search": handler }, sendResultFn });
      await router.handleInvoke(makeInvoke({ tool: "ext:search", args }));
      expect(results[0]).toMatchObject({ type: "result", success: true, data: handlerResult });
      expect(handler).toHaveBeenCalledWith(args);
    });

    it("Steps 5–7: invocation ID is preserved in the success result", async () => {
      const handler = vi.fn(async () => ({ ok: true }));
      const results: ResultMessage[] = [];
      const sendResultFn = vi.fn((r: ResultMessage) => results.push(r));
      const { router } = makeRouter({ handlers: { "ext:tool": handler }, sendResultFn });
      await router.handleInvoke(makeInvoke({ id: "unique-id-123", tool: "ext:tool" }));
      expect(results[0]?.id).toBe("unique-id-123");
    });
  });

  // ── handleInvoke — Step 8: handler throws ────────────────────────────────

  describe("handleInvoke — Step 8: handler throws", () => {
    it("Step 8: sends failure ResultMessage when handler rejects", async () => {
      const handler = vi.fn(async () => { throw new Error("Something went wrong"); });
      const results: ResultMessage[] = [];
      const sendResultFn = vi.fn((r: ResultMessage) => results.push(r));
      const { router } = makeRouter({ handlers: { "ext:broken": handler }, sendResultFn });
      await router.handleInvoke(makeInvoke({ tool: "ext:broken" }));
      expect(results[0]).toMatchObject({ type: "result", success: false });
    });

    it("Step 8: error message from handler is included in result", async () => {
      const handler = vi.fn(async () => { throw new Error("file not found"); });
      const results: ResultMessage[] = [];
      const sendResultFn = vi.fn((r: ResultMessage) => results.push(r));
      const { router } = makeRouter({ handlers: { "ext:fails": handler }, sendResultFn });
      await router.handleInvoke(makeInvoke({ tool: "ext:fails" }));
      expect(results[0]?.error).toContain("file not found");
    });
  });

  // ── handleInvoke — Step 9: timeout ───────────────────────────────────────

  describe("handleInvoke — Step 9: handler timeout", () => {
    it("Step 9: sends timeout error when handler exceeds invoke.timeout", async () => {
      vi.useFakeTimers();
      const handler = vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
        return { done: true };
      });
      const results: ResultMessage[] = [];
      const sendResultFn = vi.fn((r: ResultMessage) => results.push(r));
      const { router } = makeRouter({ handlers: { "ext:slow": handler }, sendResultFn });
      const invokePromise = router.handleInvoke(makeInvoke({ tool: "ext:slow", timeout: 100 }));
      vi.advanceTimersByTime(200);
      await invokePromise;
      expect(results[0]).toMatchObject({ type: "result", success: false });
    });
  });

  // ── handleCancel ──────────────────────────────────────────────────────────

  describe("handleCancel — 4-step cancel flow", () => {
    it("Cancel: unknown invocation ID calls sendCancelledFn with late=true", () => {
      const sendCancelledFn = vi.fn();
      const { router } = makeRouter({ sendCancelledFn });
      router.handleCancel(makeCancel("nonexistent-id"));
      expect(sendCancelledFn).toHaveBeenCalledWith("nonexistent-id", true);
    });

    it("Cancel: completed/missing invocation is always late=true", () => {
      const sendCancelledFn = vi.fn();
      const { router } = makeRouter({ sendCancelledFn });
      router.handleCancel(makeCancel("gone-id"));
      expect(sendCancelledFn).toHaveBeenCalledWith("gone-id", true);
    });

    it("Cancel: does not throw for any invocation ID (graceful)", () => {
      const { router } = makeRouter();
      expect(() => router.handleCancel(makeCancel("any-id"))).not.toThrow();
    });

    it("Cancel: cancelling an in-flight invoke sends late=false", async () => {
      vi.useFakeTimers();
      const handler = vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
        return {};
      });
      const sendCancelledFn = vi.fn();
      const { router } = makeRouter({ handlers: { "ext:long": handler }, sendCancelledFn });
      router.handleInvoke(makeInvoke({ id: "running-id", tool: "ext:long", timeout: 120_000 })).catch(() => {});
      router.handleCancel(makeCancel("running-id"));
      expect(sendCancelledFn).toHaveBeenCalledWith("running-id", false);
      vi.advanceTimersByTime(200);
    });
  });

  // ── cancelAll ─────────────────────────────────────────────────────────────

  describe("cancelAll() — already implemented", () => {
    it("cancelAll() with no in-flight invocations does not throw", () => {
      const { router } = makeRouter();
      expect(() => router.cancelAll()).not.toThrow();
    });

    it("cancelAll() resets inflight count to 0", async () => {
      vi.useFakeTimers();
      const handler = vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
        return {};
      });
      const { router } = makeRouter({ handlers: { "ext:t": handler } });
      router.handleInvoke(makeInvoke({ tool: "ext:t", timeout: 120_000 })).catch(() => {});
      router.cancelAll();
      expect(router.getInflightCount()).toBe(0);
      vi.advanceTimersByTime(200);
    });

    it("cancelAll() clears in-flight map so subsequent cancels are late=true", () => {
      const { router } = makeRouter();
      router.cancelAll();
      const sendCancelledFn = vi.fn();
      router.setSendCancelledFn(sendCancelledFn);
      router.handleCancel(makeCancel("any-id"));
      expect(sendCancelledFn).toHaveBeenCalledWith("any-id", true);
    });
  });

  // ── getInflightCount ──────────────────────────────────────────────────────

  describe("getInflightCount()", () => {
    it("returns 0 with no active invocations", () => {
      const { router } = makeRouter();
      expect(router.getInflightCount()).toBe(0);
    });

    it("returns 0 after successful completion", async () => {
      const handler = vi.fn(async () => ({ done: true }));
      const { router } = makeRouter({ handlers: { "ext:fast": handler } });
      await router.handleInvoke(makeInvoke({ tool: "ext:fast" }));
      expect(router.getInflightCount()).toBe(0);
    });
  });
});
