/**
 * comment-sync.ts — Browser Comment Synchronization
 *
 * Extracts the Chrome ↔ VSCode comment sync logic from extension.ts into a
 * focused module. Handles:
 *   - Remote browser thread/comment type definitions
 *   - Mapping remote threads/comments to unified comment_* tool args
 *   - Full bidirectional sync algorithm (upsert + delete)
 *   - Periodic sync scheduler with in-flight guard
 *
 * @module
 */

import type * as vscode from "vscode";
import type { CommentThread } from "@accordo/bridge-types";
import type { BrowserRelayLike, BrowserBridgeAPI, BrowserRelayResponse } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Interval between periodic sync runs (milliseconds). */
export const SYNC_INTERVAL_MS = 30_000;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Remote browser thread data returned by Chrome relay `get_comments` action.
 */
export interface RemoteBrowserThread {
  id: string;
  anchorKey: string;
  anchorContext?: {
    tagName?: string;
    textSnippet?: string;
    ariaLabel?: string;
    pageTitle?: string;
  };
  pageUrl: string;
  status: "open" | "resolved";
  comments: RemoteBrowserComment[];
  createdAt: string;
  lastActivity: string;
  deletedAt?: string;
}

/**
 * A single comment inside a RemoteBrowserThread.
 */
export interface RemoteBrowserComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user"; name: string };
  body: string;
  anchorKey: string;
  pageUrl: string;
  status: "open" | "resolved";
  resolutionNote?: string;
  deletedAt?: string;
}

/**
 * Shape returned by the Chrome relay `get_comments` action for a single page.
 */
export interface GetCommentsResponse {
  url: string;
  threads: RemoteBrowserThread[];
}

// ── Mappers ──────────────────────────────────────────────────────────────────

/**
 * Maps a remote Chrome BrowserCommentThread to the args for `comment_create`.
 */
export function remoteThreadToCreateArgs(
  thread: RemoteBrowserThread,
): Record<string, unknown> {
  const firstComment = thread.comments[0];
  return {
    scope: { modality: "browser", url: thread.pageUrl },
    anchor: { kind: "browser", anchorKey: thread.anchorKey },
    body: firstComment?.body ?? "",
    threadId: thread.id,
    commentId: firstComment?.id,
    context: thread.anchorContext
      ? {
          surfaceMetadata: {
            anchorKey: thread.anchorKey,
            tagName: thread.anchorContext.tagName,
            textSnippet: thread.anchorContext.textSnippet,
            ariaLabel: thread.anchorContext.ariaLabel,
            pageTitle: thread.anchorContext.pageTitle,
          },
        }
      : { surfaceMetadata: { anchorKey: thread.anchorKey } },
    authorKind: firstComment?.author?.kind === "user" ? "user" : "agent",
    authorName: firstComment?.author?.name,
  };
}

/**
 * Maps a remote Chrome BrowserComment to the args for `comment_reply`.
 */
export function remoteCommentToReplyArgs(
  comment: RemoteBrowserComment,
): Record<string, unknown> {
  return {
    threadId: comment.threadId,
    body: comment.body,
    commentId: comment.id,
    authorKind: comment.author?.kind === "user" ? "user" : "agent",
    authorName: comment.author?.name,
  };
}

// ── Sync Algorithm ───────────────────────────────────────────────────────────

/**
 * Synchronizes browser comments from Chrome extension storage into the local
 * VSCode comment store, and cleans up local threads that no longer exist
 * remotely.
 *
 * Sync algorithm:
 * 1. Pull all remote pages via relay.request("get_all_comments")
 * 2. Pull remote threads for each page via relay.request("get_comments", { url })
 * 3. Pull all local browser threads via bridge.invokeTool("comment_list", ...)
 * 4. Upsert: create missing threads, add missing replies, sync resolve/reopen status
 * 5. Delete: remove local threads not present in remote (only if full remote fetch succeeded)
 *
 * @param relay  - The browser relay connection
 * @param bridge - The VSCode bridge API for invoking comment_* tools
 * @param out    - Output channel for logging
 * @returns `"success"` if all pages synced, `"partial"` if any page fetch failed
 */
export async function syncBrowserComments(
  relay: BrowserRelayLike,
  bridge: BrowserBridgeAPI,
  out: vscode.OutputChannel,
): Promise<"success" | "partial"> {
  // Step 1: Pull remote page list
  let pagesResult: BrowserRelayResponse;
  try {
    pagesResult = await relay.request("get_all_comments", {}, 5000);
  } catch (err) {
    out.appendLine("[accordo-browser:comment-sync] get_all_comments failed — skipping sync");
    return "partial";
  }
  if (!pagesResult.success) {
    out.appendLine("[accordo-browser:comment-sync] get_all_comments failed — skipping sync");
    return "partial";
  }

  const pagesData = pagesResult.data as { pages: Array<{ url: string }> };
  const pages = pagesData.pages ?? [];
  if (pages.length === 0) {
    out.appendLine("[accordo-browser:comment-sync] no remote browser pages returned");
  }

  // Step 2: Pull threads for each page (collect all remote threads)
  const remoteThreads: RemoteBrowserThread[] = [];
  let anyPageFailed = false;

  for (const page of pages) {
    const pageResult = await relay.request("get_comments", { url: page.url }, 5000);
    if (!pageResult.success) {
      out.appendLine(
        `[accordo-browser:comment-sync] get_comments failed for ${page.url} — continuing`,
      );
      anyPageFailed = true;
      continue;
    }
    const pageData = pageResult.data as GetCommentsResponse;
    if (pageData.threads) {
      remoteThreads.push(...pageData.threads);
    }
  }

  // Build set of remote thread IDs (only non-deleted)
  const remoteThreadIds = new Set<string>(
    remoteThreads
      .filter((t) => !t.deletedAt)
      .map((t) => t.id),
  );

  // Step 3: Pull all local browser threads
  let localThreads: CommentThread[];
  try {
    const localResult = await bridge.invokeTool(
      "comment_list",
      { scope: { modality: "browser" }, detail: true },
    );
    localThreads = (localResult as CommentThread[]) ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser:comment-sync] comment_list failed: ${msg} — skipping sync`);
    return "partial";
  }

  // Step 4: Upsert remote threads into local store
  for (const remoteThread of remoteThreads) {
    if (remoteThread.deletedAt) continue;

    const existingThread = localThreads.find((t) => t.id === remoteThread.id);
    let localStatus: "open" | "resolved" = existingThread?.status ?? "open";
    const localCommentIds = new Set<string>(existingThread?.comments.map((c) => c.id) ?? []);

    if (!existingThread) {
      // Create missing thread
      try {
        await bridge.invokeTool("comment_create", remoteThreadToCreateArgs(remoteThread));
        const firstCommentId = remoteThread.comments[0]?.id;
        if (firstCommentId) localCommentIds.add(firstCommentId);
        out.appendLine(
          `[accordo-browser:comment-sync] created thread ${remoteThread.id} on ${remoteThread.pageUrl}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(
          `[accordo-browser:comment-sync] comment_create failed for ${remoteThread.id}: ${msg}`,
        );
      }
    }

    // Sync status if needed (covers both existing + newly created threads)
    const remoteStatus = remoteThread.status;
    if (localStatus !== remoteStatus) {
      try {
        if (remoteStatus === "resolved") {
          await bridge.invokeTool("comment_resolve", {
            threadId: remoteThread.id,
            resolutionNote: "Synced from browser",
          });
        } else {
          await bridge.invokeTool("comment_reopen", { threadId: remoteThread.id });
        }
        localStatus = remoteStatus;
        out.appendLine(
          `[accordo-browser:comment-sync] synced status for thread ${remoteThread.id} → ${remoteStatus}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(
          `[accordo-browser:comment-sync] status sync failed for ${remoteThread.id}: ${msg}`,
        );
      }
    }

    // Sync replies: add missing comments (covers both existing + newly created)
    for (const remoteComment of remoteThread.comments) {
      if (remoteComment.deletedAt) continue;
      if (!localCommentIds.has(remoteComment.id)) {
        try {
          await bridge.invokeTool("comment_reply", remoteCommentToReplyArgs(remoteComment));
          localCommentIds.add(remoteComment.id);
          out.appendLine(
            `[accordo-browser:comment-sync] added reply ${remoteComment.id} to thread ${remoteThread.id}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          out.appendLine(
            `[accordo-browser:comment-sync] comment_reply failed for ${remoteComment.id}: ${msg}`,
          );
        }
      }
    }
  }

  // Step 5: Delete local-only threads (only if no page fetch failed)
  if (anyPageFailed) {
    out.appendLine(
      "[accordo-browser:comment-sync] partial remote fetch — skipping deletions",
    );
    return "partial";
  }

  for (const localThread of localThreads) {
    if (!remoteThreadIds.has(localThread.id)) {
      try {
        await bridge.invokeTool("comment_delete", { threadId: localThread.id });
        out.appendLine(
          `[accordo-browser:comment-sync] deleted local-only thread ${localThread.id}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(
          `[accordo-browser:comment-sync] comment_delete failed for ${localThread.id}: ${msg}`,
        );
      }
    }
  }

  return anyPageFailed ? "partial" : "success";
}

// ── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Scheduler that runs periodic browser comment sync.
 * Runs every SYNC_INTERVAL_MS milliseconds, with an in-flight guard
 * to prevent overlapping sync runs.
 */
export class BrowserCommentSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;
  private readonly relay: BrowserRelayLike;
  private readonly bridge: BrowserBridgeAPI;
  private readonly out: vscode.OutputChannel;

  constructor(
    relay: BrowserRelayLike,
    bridge: BrowserBridgeAPI,
    out: vscode.OutputChannel,
  ) {
    this.relay = relay;
    this.bridge = bridge;
    this.out = out;
  }

  /** Schedule the periodic sync loop. Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.out.appendLine(
      `[accordo-browser:comment-sync] starting periodic sync every ${SYNC_INTERVAL_MS / 1000}s`,
    );
    this.timer = setInterval(() => {
      void this.runSync();
    }, SYNC_INTERVAL_MS);
  }

  /** Immediately trigger a sync (no-op if one is already in-flight). */
  async syncNow(): Promise<void> {
    if (this.syncing) {
      this.out.appendLine("[accordo-browser:comment-sync] sync already in-flight — skipping");
      return;
    }
    await this.runSync();
  }

  private async runSync(): Promise<void> {
    if (this.syncing) return; // guard against re-entry from syncNow
    this.syncing = true;
    try {
      this.out.appendLine("[accordo-browser:comment-sync] starting sync...");
      const result = await syncBrowserComments(this.relay, this.bridge, this.out);
      this.out.appendLine(
        `[accordo-browser:comment-sync] sync complete: ${result}`,
      );
    } catch (err) {
      // Never throw from periodic task — log and continue
      const msg = err instanceof Error ? err.message : String(err);
      this.out.appendLine(`[accordo-browser:comment-sync] unexpected error: ${msg}`);
    } finally {
      this.syncing = false;
    }
  }

  /** Stop the scheduler and clear the timer. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.out.appendLine("[accordo-browser:comment-sync] scheduler stopped");
    }
  }
}