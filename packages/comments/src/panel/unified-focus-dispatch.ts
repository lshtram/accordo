import type { CommentThread } from "@accordo/bridge-types";
import type { NavigationDispatchPlan } from "./navigation-contract.js";

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
 * Build a source-aware focus plan that guarantees slide dispatch parity.
 */
export function buildUnifiedThreadFocusPlan(
  request: ThreadFocusRequest,
): UnifiedThreadFocusPlan {
  throw new Error("not implemented");
}
