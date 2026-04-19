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
 * Pattern that identifies a slide presentation block.
 * Matches blockIds of the form: slide:{index}:{x}:{y}
 */
const SLIDE_BLOCK_ID_PATTERN = /^slide:\d+:\d+\.\d+:\d+\.\d+$/;

/**
 * Derive canonical slide focus args: (uri, threadId, blockId).
 *
 * blockId is constructed as slide:{slideIndex}:{x}:{y} where coordinates
 * come from the anchor's SlideCoordinates.
 */
export function buildSlideFocusArgs(
  thread: CommentThread,
): readonly [uri: string, threadId: string, blockId: string] {
  const anchor = thread.anchor;
  if (anchor.kind !== "surface" || anchor.surfaceType !== "slide") {
    throw new Error("buildSlideFocusArgs requires a slide surface anchor");
  }
  const coords = anchor.coordinates;
  if (coords.type !== "slide") {
    throw new Error("buildSlideFocusArgs requires slide coordinates");
  }
  const blockId = `slide:${coords.slideIndex}:${coords.x}:${coords.y}`;
  return [anchor.uri, thread.id, blockId] as const;
}

/**
 * Check if a blockId indicates a slide presentation target.
 * Slide hints take precedence over text/markdown-preview inference.
 */
function isSlideBlockId(blockId: string | undefined): blockId is string {
  if (!blockId) return false;
  return SLIDE_BLOCK_ID_PATTERN.test(blockId);
}

/**
 * Extract blockId from anchor if it exists.
 * For text anchors, blockId may be present in the anchor object directly.
 */
function getBlockId(anchor: CommentThread["anchor"]): string | undefined {
  if (anchor.kind === "text") {
    // blockId is optional on CommentAnchorText — use type assertion
    // since the actual runtime value may be present
    return (anchor as { blockId?: string }).blockId;
  }
  if (anchor.kind === "surface" && anchor.coordinates.type === "block") {
    return anchor.coordinates.blockId;
  }
  return undefined;
}

/**
 * Build command-level dispatch plan for one thread.
 *
 * Surfaces are determined in this precedence order:
 * 1. Explicit surfaceType on the anchor (for surface anchors)
 * 2. Slide blockId hint in text anchor's blockId field (M45-NR-14 precedence rule)
 * 3. File extension inference (.md → text) — only for text anchors without slide hint
 */
export function buildNavigationDispatchPlan(
  thread: CommentThread,
): NavigationDispatchPlan {
  const anchor = thread.anchor;

  // ── Text anchor with slide blockId hint takes precedence (M45-NR-14) ──
  if (anchor.kind === "text") {
    const blockId = getBlockId(anchor);
    if (isSlideBlockId(blockId)) {
      return {
        target: "slide",
        primaryCommand: SURFACE_FOCUS_COMMANDS.slide,
        primaryArgs: [anchor.uri, thread.id, blockId],
        fallbackCommand: DEFERRED_COMMANDS.PRESENTATION_GOTO,
        fallbackArgs: [],
      };
    }
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

  // Surface anchors — surfaceType is explicit
  if (anchor.surfaceType === "markdown-preview") {
    // Q-MD-01: 3-element args [uri, threadId, blockId]
    const blockId = getBlockId(anchor);
    return {
      target: "markdown-preview",
      primaryCommand: SURFACE_FOCUS_COMMANDS.markdownPreview,
      primaryArgs: [anchor.uri, thread.id, blockId ?? ""],
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