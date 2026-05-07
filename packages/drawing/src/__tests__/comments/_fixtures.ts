/**
 * Shared test fixtures for drawing comments bridge tests.
 * Re-exports typed stubs from drawing-comments-bridge.test.ts.
 */

import { vi } from "vitest";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
import type { HostMessage } from "@accordo/comment-sdk";

export function createStubAdapter() {
  const adapter = {
    createThread: vi.fn<SurfaceCommentAdapter["createThread"]>(),
    reply: vi.fn<SurfaceCommentAdapter["reply"]>(),
    resolve: vi.fn<SurfaceCommentAdapter["resolve"]>(),
    reopen: vi.fn<SurfaceCommentAdapter["reopen"]>(),
    delete: vi.fn<SurfaceCommentAdapter["delete"]>(),
    getThreadsForUri: vi.fn<SurfaceCommentAdapter["getThreadsForUri"]>(() => []),
    onChanged: vi.fn<SurfaceCommentAdapter["onChanged"]>(),
  };
  return adapter;
}

export function createStubSender() {
  return {
    postMessage: vi.fn<{ postMessage(msg: HostMessage): Promise<boolean> }["postMessage"]>(),
  };
}