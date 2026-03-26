/**
 * Tests for activate() exports — registerBrowserNotifier
 *
 * Verifies that activate() returns an exports object with registerBrowserNotifier
 * that registers a secondary CommentUINotifier on the composite, enabling
 * accordo-browser to receive notifications on actual comment mutations.
 *
 * Requirements:
 *   EXP-01: activate() returns { registerBrowserNotifier: Function }
 *   EXP-02: Registering a notifier causes it to be called when the composite fires addThread
 *   EXP-03: The returned disposable correctly unregisters
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetMockState,
  extensions,
  createMockExtensionContext,
} from "./mocks/vscode.js";
import { activate } from "../extension.js";
import type { CommentUINotifier } from "../comment-tools.js";
import type { CommentThread } from "@accordo/bridge-types";

// ── Bridge mock factory ──────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  name: string;
  handler: ToolHandler;
}

function makeBridge() {
  const registeredTools: RegisteredTool[] = [];
  return {
    bridge: {
      registerTools: vi.fn().mockImplementation(
        (_id: string, tools: Array<{ name: string; handler: ToolHandler }>) => {
          for (const t of tools) registeredTools.push({ name: t.name, handler: t.handler });
          return { dispose: vi.fn() };
        },
      ),
      publishState: vi.fn(),
    },
    registeredTools,
  };
}

function setupWithBridge(): ReturnType<typeof makeBridge> {
  const m = makeBridge();
  (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
    (id: string) => {
      if (id === "accordo.accordo-bridge") {
        return { exports: m.bridge, isActive: true };
      }
      return undefined;
    },
  );
  return m;
}

function setupWithoutBridge(): void {
  (extensions as Record<string, unknown>).getExtension = vi.fn().mockReturnValue(undefined);
}

beforeEach(() => {
  resetMockState();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("activate() exports — registerBrowserNotifier", () => {

  it("EXP-01: activate() returns an object with registerBrowserNotifier function", async () => {
    setupWithoutBridge();
    const ctx = createMockExtensionContext();

    const exports = await activate(ctx);

    expect(exports).toBeDefined();
    expect(typeof exports.registerBrowserNotifier).toBe("function");
  });

  it("EXP-01b: activate() returns registerBrowserNotifier even when bridge is not available", async () => {
    setupWithoutBridge();
    const ctx = createMockExtensionContext();

    const exports = await activate(ctx);

    expect(typeof exports.registerBrowserNotifier).toBe("function");
  });

  it("EXP-02: registering a notifier causes it to be called when composite fires addThread via a tool", async () => {
    const { bridge, registeredTools } = setupWithBridge();
    void bridge; // used via mock

    const ctx = createMockExtensionContext();
    const exports = await activate(ctx);

    // Register a secondary notifier
    const addThreadSpy = vi.fn();
    const notifier: CommentUINotifier = {
      addThread: addThreadSpy,
      updateThread: vi.fn(),
      removeThread: vi.fn(),
    };
    exports.registerBrowserNotifier(notifier);

    // Invoke the comment_create tool handler directly to trigger composite.addThread
    const createTool = registeredTools.find(t => t.name === "comment_create");
    expect(createTool).toBeDefined();
    await createTool!.handler({
      uri: "file:///test/foo.ts",
      anchor: { kind: "file" },
      body: "Test comment body",
    });

    // The secondary notifier's addThread must have been called
    expect(addThreadSpy).toHaveBeenCalledTimes(1);
    const calledWith = addThreadSpy.mock.calls[0]?.[0] as CommentThread;
    expect(calledWith).toBeDefined();
    expect(typeof calledWith.id).toBe("string");
  });

  it("EXP-03: the returned disposable correctly unregisters the notifier", async () => {
    const { bridge, registeredTools } = setupWithBridge();
    void bridge; // used via mock

    const ctx = createMockExtensionContext();
    const exports = await activate(ctx);

    const addThreadSpy = vi.fn();
    const notifier: CommentUINotifier = {
      addThread: addThreadSpy,
      updateThread: vi.fn(),
      removeThread: vi.fn(),
    };

    // Register and immediately dispose
    const sub = exports.registerBrowserNotifier(notifier);
    expect(sub).toHaveProperty("dispose");
    expect(typeof sub.dispose).toBe("function");
    sub.dispose();

    // After dispose, invoke the create tool — notifier must NOT be called
    const createTool = registeredTools.find(t => t.name === "comment_create");
    expect(createTool).toBeDefined();
    await createTool!.handler({
      uri: "file:///test/after-unsub.ts",
      anchor: { kind: "file" },
      body: "Should not fire",
    });

    expect(addThreadSpy).not.toHaveBeenCalled();
  });
});
