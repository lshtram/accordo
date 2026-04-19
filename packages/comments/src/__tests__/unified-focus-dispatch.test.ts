/**
 * unified-focus-dispatch.test.ts — Tests for unified thread-focus dispatch
 *
 * Requirements covered:
 *   M45-NR-15  buildUnifiedThreadFocusPlan — native-comments slide focus uses shared planner
 *   M45-NR-16  Slide dispatch parity — panel and native-comments produce identical command tuples
 *
 * Test naming: R-<requirement>-<NN>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildUnifiedThreadFocusPlan,
  type ThreadFocusRequest,
  type UnifiedThreadFocusPlan,
} from "../panel/unified-focus-dispatch.js";
import type { CommentThread, CommentAnchorSurface } from "@accordo/bridge-types";
import { DEFERRED_COMMANDS, CAPABILITY_COMMANDS } from "@accordo/capabilities";

// API checklist:
// ✓ buildUnifiedThreadFocusPlan() — R-NR-15 (4 tests), R-NR-16 (2 tests)

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSlideThread(overrides?: Partial<CommentThread>): CommentThread {
  return {
    id: "thread-slide-1",
    anchor: {
      kind: "surface",
      uri: "file:///project/deck.md",
      surfaceType: "slide",
      coordinates: {
        type: "slide",
        slideIndex: 2,
        x: 0.5000,
        y: 0.5000,
      },
    },
    comments: [
      {
        id: "comment-1",
        threadId: "thread-slide-1",
        createdAt: "2026-04-19T10:00:00Z",
        author: { kind: "user", name: "Developer" },
        body: "Fix this",
        anchor: {
          kind: "surface",
          uri: "file:///project/deck.md",
          surfaceType: "slide",
          coordinates: { type: "slide", slideIndex: 2, x: 0.5000, y: 0.5000 },
        },
        status: "open",
        intent: "fix",
      },
    ],
    status: "open",
    createdAt: "2026-04-19T10:00:00Z",
    lastActivity: "2026-04-19T10:00:00Z",
    ...overrides,
  };
}

// ── R-NR-15: buildUnifiedThreadFocusPlan for native-comments ───────────────────

describe("R-NR-15: buildUnifiedThreadFocusPlan — native-comments must use shared planner", () => {
  it("R-NR-15-01: source 'native-comments' with slide anchor does NOT use PREVIEW_FOCUS_THREAD", () => {
    // M45-NR-15: Native UI focus (from VS Code comments panel) for slide surface
    // must use shared planner path, NOT accordo_preview_internal_focusThread.
    const thread = makeSlideThread();
    const request: ThreadFocusRequest = { thread, source: "native-comments" };
    const plan = buildUnifiedThreadFocusPlan(request);

    // The primary command must NOT be the markdown-preview focus command.
    expect(plan.dispatchPlan.primaryCommand).not.toBe(CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD);
  });

  it("R-NR-15-02: source 'native-comments' with slide anchor uses PRESENTATION_FOCUS_THREAD", () => {
    // The canonical focus command for slides is accordo.presentation.internal.focusThread.
    const thread = makeSlideThread();
    const request: ThreadFocusRequest = { thread, source: "native-comments" };
    const plan = buildUnifiedThreadFocusPlan(request);

    expect(plan.dispatchPlan.primaryCommand).toBe(DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD);
  });

  it("R-NR-15-03: source 'panel' with slide anchor also uses PRESENTATION_FOCUS_THREAD", () => {
    // Both entry points must converge on the same command.
    const thread = makeSlideThread();
    const panelRequest: ThreadFocusRequest = { thread, source: "panel" };
    const plan = buildUnifiedThreadFocusPlan(panelRequest);

    expect(plan.dispatchPlan.primaryCommand).toBe(DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD);
  });

  it("R-NR-15-04: source 'native-comments' with non-slide anchor does not throw", () => {
    // The planner must handle non-slide anchors gracefully.
    const thread: CommentThread = {
      id: "thread-text-1",
      anchor: {
        kind: "text",
        uri: "file:///project/src/auth.ts",
        range: { startLine: 42, startChar: 0, endLine: 42, endChar: 0 },
        docVersion: 1,
      },
      comments: [
        {
          id: "comment-1",
          threadId: "thread-text-1",
          createdAt: "2026-04-19T10:00:00Z",
          author: { kind: "user", name: "Developer" },
          body: "Fix this",
          anchor: {
            kind: "text",
            uri: "file:///project/src/auth.ts",
            range: { startLine: 42, startChar: 0, endLine: 42, endChar: 0 },
            docVersion: 1,
          },
          status: "open",
          intent: "fix",
        },
      ],
      status: "open",
      createdAt: "2026-04-19T10:00:00Z",
      lastActivity: "2026-04-19T10:00:00Z",
    };
    const request: ThreadFocusRequest = { thread, source: "native-comments" };
    // Must not throw for non-slide surfaces.
    expect(() => buildUnifiedThreadFocusPlan(request)).not.toThrow();
  });
});

// ── R-NR-16: Slide dispatch parity ───────────────────────────────────────────

describe("R-NR-16: Slide dispatch parity — panel vs native-comments", () => {
  it("R-NR-16-01: same slide thread produces identical primaryCommand for both sources", () => {
    // M45-NR-16: user-authored and agent-authored slide threads must resolve to
    // the same focus command tuple.
    const thread = makeSlideThread({ id: "thread-parity-1" });
    const panelRequest: ThreadFocusRequest = { thread, source: "panel" };
    const nativeRequest: ThreadFocusRequest = { thread, source: "native-comments" };

    const panelPlan = buildUnifiedThreadFocusPlan(panelRequest);
    const nativePlan = buildUnifiedThreadFocusPlan(nativeRequest);

    expect(panelPlan.dispatchPlan.primaryCommand).toBe(nativePlan.dispatchPlan.primaryCommand);
  });

  it("R-NR-16-02: same slide thread produces identical primaryArgs for both sources", () => {
    // The command tuple (uri, threadId, blockId) must be source-invariant.
    const thread = makeSlideThread({ id: "thread-parity-2" });
    const panelRequest: ThreadFocusRequest = { thread, source: "panel" };
    const nativeRequest: ThreadFocusRequest = { thread, source: "native-comments" };

    const panelPlan = buildUnifiedThreadFocusPlan(panelRequest);
    const nativePlan = buildUnifiedThreadFocusPlan(nativeRequest);

    expect(panelPlan.dispatchPlan.primaryArgs).toEqual(nativePlan.dispatchPlan.primaryArgs);
  });

  it("R-NR-16-03: primaryArgs for slide thread contain (uri, threadId, blockId)", () => {
    // The command tuple format must be: (uri: string, threadId: string, blockId: string).
    const thread = makeSlideThread({ id: "thread-parity-3" });
    const request: ThreadFocusRequest = { thread, source: "panel" };
    const plan = buildUnifiedThreadFocusPlan(request);

    const [uri, threadId, blockId] = plan.dispatchPlan.primaryArgs as [string, string, string];
    expect(uri).toBe(thread.anchor.uri);
    expect(threadId).toBe(thread.id);
    expect(blockId).toContain("slide:");
  });

  it("R-NR-16-04: author.kind parity — user and agent produce identical focus plan for same anchor", () => {
    // M45-NR-16: user-authored and agent-authored slide threads must NOT diverge.
    // Vary author.kind while keeping anchor identical; verify primaryCommand and
    // primaryArgs are source-equivalent.
    const anchor = {
      kind: "surface" as const,
      uri: "file:///project/deck.md",
      surfaceType: "slide" as const,
      coordinates: {
        type: "slide" as const,
        slideIndex: 2,
        x: 0.5000,
        y: 0.5000,
      },
    };

    const userThread: CommentThread = {
      id: "thread-user-1",
      anchor,
      comments: [
        {
          id: "comment-u1",
          threadId: "thread-user-1",
          createdAt: "2026-04-19T10:00:00Z",
          author: { kind: "user", name: "Developer" },
          body: "Fix this",
          anchor,
          status: "open",
          intent: "fix",
        },
      ],
      status: "open",
      createdAt: "2026-04-19T10:00:00Z",
      lastActivity: "2026-04-19T10:00:00Z",
    };

    const agentThread: CommentThread = {
      id: "thread-agent-1",
      anchor,
      comments: [
        {
          id: "comment-a1",
          threadId: "thread-agent-1",
          createdAt: "2026-04-19T10:00:00Z",
          author: { kind: "agent", name: "Accordo Assistant" },
          body: "Suggestion",
          anchor,
          status: "open",
          intent: "suggest",
        },
      ],
      status: "open",
      createdAt: "2026-04-19T10:00:00Z",
      lastActivity: "2026-04-19T10:00:00Z",
    };

    const userPlan = buildUnifiedThreadFocusPlan({ thread: userThread, source: "panel" });
    const agentPlan = buildUnifiedThreadFocusPlan({ thread: agentThread, source: "panel" });

    expect(userPlan.dispatchPlan.primaryCommand).toBe(agentPlan.dispatchPlan.primaryCommand);
    expect(userPlan.dispatchPlan.primaryArgs).toEqual(agentPlan.dispatchPlan.primaryArgs);
  });
});
