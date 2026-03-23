/**
 * StateContribution — Publishes comment modality state to Hub.
 *
 * Listens for store changes and calls bridge.publishState('accordo-comments', summary).
 * The summary appears in the agent's system prompt at GET /instructions.
 *
 * Source: comments-architecture.md §7
 */

import type { CommentStateSummary, CommentThreadSummary } from "@accordo/bridge-types";
import {
  COMMENT_MAX_SUMMARY_THREADS,
  COMMENT_SUMMARY_PREVIEW_LENGTH,
} from "@accordo/bridge-types";
import type { CommentStore } from "./comment-store.js";

// ── StateBridgeAPI ────────────────────────────────────────────────────────────

/** Minimal BridgeAPI surface needed by state contribution. */
export interface StateBridgeAPI {
  publishState(extensionId: string, state: Record<string, unknown>): void;
}

// ── buildCommentSummary ───────────────────────────────────────────────────────

/**
 * Build a CommentStateSummary from the current store state.
 * At most COMMENT_MAX_SUMMARY_THREADS open threads, most recent first,
 * body truncated to COMMENT_SUMMARY_PREVIEW_LENGTH chars.
 *
 * @param store - The CommentStore to read from
 * @returns The summary object for publishState
 */
export function buildCommentSummary(store: CommentStore): CommentStateSummary {
  const counts = store.getCounts();
  const allThreads = store.getAllThreads();

  const openThreads = allThreads
    .filter(t => t.status === "open")
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
    .slice(0, COMMENT_MAX_SUMMARY_THREADS);

  const summary: CommentThreadSummary[] = openThreads.map(thread => {
    const anchor = thread.anchor;
    const firstComment = thread.comments[0];
    const preview = (firstComment?.body ?? "").slice(0, COMMENT_SUMMARY_PREVIEW_LENGTH);

    const entry: CommentThreadSummary = {
      threadId: thread.id,
      uri: anchor.uri,
      preview,
    };

    if (firstComment?.intent !== undefined) {
      entry.intent = firstComment.intent;
    }

    if (anchor.kind === "text") {
      entry.line = anchor.range.startLine;
    } else if (anchor.kind === "surface") {
      entry.surfaceType = anchor.surfaceType;
      if (anchor.coordinates.type === "diagram-node") {
        entry.nodeId = anchor.coordinates.nodeId;
      }
    }

    return entry;
  });

  return {
    isOpen: true,
    openThreadCount: counts.open,
    resolvedThreadCount: counts.resolved,
    summary,
    // Remind the agent of the available MCP tool names.
    // "Review threads" = VS Code gutter annotation panel — not inline code comments.
    tools: "Review-thread tools: comment_list | comment_get | comment_create | comment_reply | comment_resolve | comment_delete | comment_reopen",
    // Full un-truncated thread list for the /state debug endpoint (M43).
    threads: allThreads,
  };
}

// ── startStateContribution ────────────────────────────────────────────────────

/**
 * Wire up reactive state publishing.
 * - Publishes initial state immediately
 * - Re-publishes on every store change
 *
 * @param bridge - BridgeAPI with publishState
 * @param store - The CommentStore to observe
 * @returns Disposable to stop listening
 */
export function startStateContribution(
  bridge: StateBridgeAPI,
  store: CommentStore,
): { dispose(): void } {
  const publish = (): void => {
    bridge.publishState(
      "accordo-comments",
      buildCommentSummary(store) as unknown as Record<string, unknown>,
    );
  };

  publish();

  const subscription = store.onChanged(publish);

  return {
    dispose() {
      subscription.dispose();
    },
  };
}
