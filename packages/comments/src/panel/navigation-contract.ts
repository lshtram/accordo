import type { CommentThread } from "@accordo/bridge-types";
import { CAPABILITY_COMMANDS, DEFERRED_COMMANDS } from "@accordo/capabilities";

/**
 * Canonical surface → focus command mapping for Comments Panel navigation.
 *
 * Priority Q design contract:
 * - markdown preview uses PREVIEW_FOCUS_THREAD
 * - slide uses PRESENTATION_FOCUS_THREAD (uri, threadId, blockId)
 * - diagram uses DIAGRAM_FOCUS_THREAD
 * - browser uses BROWSER_FOCUS_THREAD
 */
export const SURFACE_FOCUS_COMMANDS = {
  markdownPreview: CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD,
  slide: DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD,
  diagram: CAPABILITY_COMMANDS.DIAGRAM_FOCUS_THREAD,
  browser: DEFERRED_COMMANDS.BROWSER_FOCUS_THREAD,
} as const;

export type SurfaceNavigationTarget =
  | "text"
  | "file"
  | "markdown-preview"
  | "slide"
  | "diagram"
  | "browser"
  | "unknown-surface";

/**
 * Executable plan returned by the router planner before command dispatch.
 *
 * The planner is pure and side-effect free; dispatch is done by navigateToThread.
 */
export interface NavigationDispatchPlan {
  readonly target: SurfaceNavigationTarget;
  readonly primaryCommand?: string;
  readonly primaryArgs: readonly unknown[];
  readonly fallbackCommand?: string;
  readonly fallbackArgs?: readonly unknown[];
  readonly disconnectedMessage?: string;
}

/**
 * Derive canonical slide focus args: (uri, threadId, blockId).
 *
 * Implemented in Phase C once slide block-id derivation rules are finalized.
 */
export function buildSlideFocusArgs(
  thread: CommentThread,
): readonly [uri: string, threadId: string, blockId: string] {
  void thread;
  throw new Error("not implemented");
}

/**
 * Build command-level dispatch plan for one thread.
 *
 * NOTE: This currently describes the intended Priority Q contract only.
 * Runtime dispatch is intentionally deferred to Phase C implementation.
 */
export function buildNavigationDispatchPlan(
  thread: CommentThread,
): NavigationDispatchPlan {
  const anchor = thread.anchor;

  if (anchor.kind === "text") {
    return {
      target: "text",
      primaryArgs: [],
    };
  }

  if (anchor.kind === "file") {
    return {
      target: "file",
      primaryArgs: [],
    };
  }

  if (anchor.surfaceType === "markdown-preview") {
    return {
      target: "markdown-preview",
      primaryCommand: SURFACE_FOCUS_COMMANDS.markdownPreview,
      primaryArgs: [anchor.uri, thread.id],
    };
  }

  if (anchor.surfaceType === "slide") {
    return {
      target: "slide",
      primaryCommand: SURFACE_FOCUS_COMMANDS.slide,
      primaryArgs: buildSlideFocusArgs(thread),
      fallbackCommand: DEFERRED_COMMANDS.PRESENTATION_GOTO,
      fallbackArgs: [],
    };
  }

  if (anchor.surfaceType === "diagram") {
    return {
      target: "diagram",
      primaryCommand: SURFACE_FOCUS_COMMANDS.diagram,
      primaryArgs: [thread.id, anchor.uri],
      disconnectedMessage: "Diagram extension not connected.",
    };
  }

  if (anchor.surfaceType === "browser") {
    return {
      target: "browser",
      primaryCommand: SURFACE_FOCUS_COMMANDS.browser,
      primaryArgs: [thread.id],
      disconnectedMessage: "Browser extension not connected.",
    };
  }

  return {
    target: "unknown-surface",
    primaryArgs: [],
  };
}
