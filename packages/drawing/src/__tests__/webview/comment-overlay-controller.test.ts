// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SdkInitOptions, SdkThread } from "@accordo/comment-sdk";
import { DrawingCommentOverlayController, type CommentSdkLike } from "../../webview/comment-overlay-controller.js";

function thread(id: string, blockId: string): SdkThread {
  return {
    id,
    blockId,
    status: "open",
    hasUnread: false,
    comments: [],
  };
}

function createSdkStub() {
  let initOpts: SdkInitOptions | null = null;
  const sdk: CommentSdkLike = {
    init: vi.fn((opts: SdkInitOptions) => {
      initOpts = opts;
    }),
    loadThreads: vi.fn(),
    openPopover: vi.fn(),
    reposition: vi.fn(),
    destroy: vi.fn(),
    addThread: vi.fn(),
    updateThread: vi.fn(),
    removeThread: vi.fn(),
  };
  return {
    sdk,
    getInitOpts: () => initOpts,
  };
}

describe("webview/comment-overlay-controller", () => {
  afterEach(() => {
    document.querySelectorAll("#accordo-drawing-pin-zoom").forEach((style) => style.remove());
  });

  it("handles comments:load and comments:focus host messages through SDK", () => {
    const { sdk } = createSdkStub();
    const controller = new DrawingCommentOverlayController({
      container: {} as HTMLElement,
      sdk,
      postMessage: vi.fn(),
      getSceneElements: () => [],
      getViewport: () => ({ scrollX: 0, scrollY: 0, zoom: 1 }),
    });
    controller.init();

    const loaded = controller.handleHostMessage({ type: "comments:load", threads: [thread("t1", "node:A")] });
    expect(loaded).toBe(true);
    expect(sdk.loadThreads).toHaveBeenCalledWith([thread("t1", "node:A")]);
    expect(sdk.reposition).toHaveBeenCalled();

    const focused = controller.handleHostMessage({ type: "comments:focus", threadId: "t1" });
    expect(focused).toBe(true);
    expect(sdk.openPopover).toHaveBeenCalledWith("t1");
  });

  it("wires SDK callbacks to canonical webview host messages", () => {
    const { sdk, getInitOpts } = createSdkStub();
    const postMessage = vi.fn();
    const controller = new DrawingCommentOverlayController({
      container: {} as HTMLElement,
      sdk,
      postMessage,
      getSceneElements: () => [],
      getViewport: () => ({ scrollX: 0, scrollY: 0, zoom: 1 }),
    });

    controller.init();
    const opts = getInitOpts();
    expect(opts).not.toBeNull();

    opts!.callbacks.onCreate("node:A", "hello", "review");
    opts!.callbacks.onReply("t1", "reply");
    opts!.callbacks.onResolve("t1", "done");
    opts!.callbacks.onReopen("t1");
    opts!.callbacks.onDelete("t1", "c1");

    expect(postMessage).toHaveBeenNthCalledWith(1, { type: "comment:create", blockId: "node:A", body: "hello", intent: "review" });
    expect(postMessage).toHaveBeenNthCalledWith(2, { type: "comment:reply", threadId: "t1", body: "reply" });
    expect(postMessage).toHaveBeenNthCalledWith(3, { type: "comment:resolve", threadId: "t1", resolutionNote: "done" });
    expect(postMessage).toHaveBeenNthCalledWith(4, { type: "comment:reopen", threadId: "t1" });
    expect(postMessage).toHaveBeenNthCalledWith(5, { type: "comment:delete", threadId: "t1", commentId: "c1" });
  });

  it("provides blockIdFromEvent for SDK Alt-click creation on canvas-backed nodes", () => {
    const { getInitOpts, sdk } = createSdkStub();
    const container = {
      getBoundingClientRect: vi.fn(() => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      })),
    } as unknown as HTMLElement;
    const controller = new DrawingCommentOverlayController({
      container,
      sdk,
      postMessage: vi.fn(),
      getSceneElements: () => [{
        id: "el-A",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 100,
        height: 60,
        customData: {
          accordo: {
            version: 1,
            entityKind: "node",
            identity: "A",
            sceneRole: "primary",
            sourcePath: "demo.mmd",
            status: "active",
          },
        },
      }],
      getViewport: () => ({ scrollX: 10, scrollY: 20, zoom: 2 }),
    });

    controller.init();

    const blockId = getInitOpts()?.blockIdFromEvent?.({
      clientX: 60,
      clientY: 80,
      altKey: true,
    } as MouseEvent);
    expect(blockId).toBe("node:A");
  });

  it("repositions and scales pins when Excalidraw viewport changes", () => {
    const { sdk } = createSdkStub();
    let viewport = { scrollX: 0, scrollY: 0, zoom: 1 };
    const controller = new DrawingCommentOverlayController({
      container: document.createElement("div"),
      sdk,
      postMessage: vi.fn(),
      getSceneElements: () => [],
      getViewport: () => viewport,
    });

    controller.init();
    viewport = { scrollX: 40, scrollY: 25, zoom: 1.5 };
    controller.onViewportChanged();

    expect(sdk.reposition).toHaveBeenCalled();
    const style = document.getElementById("accordo-drawing-pin-zoom");
    expect(style?.textContent).toContain("width:33px");
    expect(style?.textContent).toContain("font-size:17px");

    controller.destroy();
  });
});
