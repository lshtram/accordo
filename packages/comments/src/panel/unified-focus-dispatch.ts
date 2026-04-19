import { DEFERRED_COMMANDS, CAPABILITY_COMMANDS } from "@accordo/capabilities";
import type { CommentThread } from "@accordo/bridge-types";
import type { NavigationDispatchPlan } from "./navigation-contract.js";
import { buildSlideFocusArgs } from "./navigation-contract.js";

/**
 * Originating UI surface for a thread-focus action.
 */
export type ThreadFocusSource = "panel" | "native-comments";

/**
 * Unified request model so all thread-focus entry points share one planner.
 */
export interface ThreadFocusRequest {
  readonly thread: CommentThread;
  readonly source: ThreadFocusSource;
}

/**
 * Output contract for a source-aware thread-focus planner.
 */
export interface UnifiedThreadFocusPlan {
  readonly source: ThreadFocusSource;
  readonly dispatchPlan: NavigationDispatchPlan;
}

/**
 * Pattern that identifies a slide presentation block.
 * Matches blockIds of the form: slide:{index}:{x}:{y}
 */
const SLIDE_BLOCK_ID_PATTERN = /^slide:\d+:\d+\.\d+:\d+\.\d+$/;

const VALID_SURFACE_TYPES = [
  "markdown-preview",
  "diagram",
  "browser",
] as const;

function isSlideBlockId(blockId: string | undefined): blockId is string {
  if (!blockId) return false;
  return SLIDE_BLOCK_ID_PATTERN.test(blockId);
}

function isValidSurfaceTarget(
  surfaceType: string,
): surfaceType is (typeof VALID_SURFACE_TYPES)[number] {
  return (VALID_SURFACE_TYPES as readonly string[]).includes(surfaceType);
}

/**
 * Build a source-aware focus plan that guarantees slide dispatch parity.
 */
export function buildUnifiedThreadFocusPlan(
  request: ThreadFocusRequest,
): UnifiedThreadFocusPlan {
  const { thread, source } = request;
  const anchor = thread.anchor;

  // Surface anchor — explicit surfaceType
  if (anchor.kind === "surface") {
    if (anchor.surfaceType === "slide") {
      return {
        source,
        dispatchPlan: {
          target: "slide",
          primaryCommand: DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD,
          primaryArgs: buildSlideFocusArgs(thread),
          fallbackCommand: DEFERRED_COMMANDS.PRESENTATION_GOTO,
          fallbackArgs: [],
        },
      };
    }
    // Non-slide surface types use their surface-specific commands
    // Cast to known union values; invalid surface types fall through to unknown-surface
    const target = isValidSurfaceTarget(anchor.surfaceType) ? anchor.surfaceType : "unknown-surface";
    return {
      source,
      dispatchPlan: {
        target,
        primaryArgs: [],
      },
    };
  }

  // Text anchor — check for slide blockId hint
  if (anchor.kind === "text") {
    const blockId = (anchor as { blockId?: string }).blockId;
    if (isSlideBlockId(blockId)) {
      return {
        source,
        dispatchPlan: {
          target: "slide",
          primaryCommand: DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD,
          primaryArgs: [anchor.uri, thread.id, blockId],
          fallbackCommand: DEFERRED_COMMANDS.PRESENTATION_GOTO,
          fallbackArgs: [],
        },
      };
    }
    // Non-slide text anchor
    return {
      source,
      dispatchPlan: {
        target: "text",
        primaryArgs: [],
      },
    };
  }

  // File anchor
  if (anchor.kind === "file") {
    return {
      source,
      dispatchPlan: {
        target: "file",
        primaryArgs: [],
      },
    };
  }

  // Unknown anchor kind
  return {
    source,
    dispatchPlan: {
      target: "unknown-surface",
      primaryArgs: [],
    },
  };
}
