import type * as vscode from "vscode";
import type { CommentThread } from "@accordo/bridge-types";
import type { BrowserBridgeAPI, BrowserRelayLike, BrowserRelayResponse } from "./types.js";
import { deleteMissingReplies, getActiveLocalCommentIds } from "./comment-sync-replies.js";
import type { GetCommentsResponse, RemoteBrowserThread } from "./comment-sync-types.js";
import { remoteCommentToReplyArgs, remoteThreadToCreateArgs } from "./comment-sync-mappers.js";

export async function syncBrowserComments(
  relay: BrowserRelayLike,
  bridge: BrowserBridgeAPI,
  out: vscode.OutputChannel,
): Promise<"success" | "partial"> {
  let pagesResult: BrowserRelayResponse;
  try {
    pagesResult = await relay.request("get_all_comments", {}, 5000);
  } catch {
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

  const remoteThreads: RemoteBrowserThread[] = [];
  let anyPageFailed = false;

  for (const page of pages) {
    const pageResult = await relay.request("get_comments", { url: page.url }, 5000);
    if (!pageResult.success) {
      out.appendLine(`[accordo-browser:comment-sync] get_comments failed for ${page.url} — continuing`);
      anyPageFailed = true;
      continue;
    }
    const pageData = pageResult.data as GetCommentsResponse;
    if (pageData.threads) {
      remoteThreads.push(...pageData.threads);
    }
  }

  const remoteThreadIds = new Set<string>(remoteThreads.filter((t) => !t.deletedAt).map((t) => t.id));

  let localThreads: CommentThread[];
  try {
    const localResult = await bridge.invokeTool("comment_list", { scope: { modality: "browser" }, detail: true });
    localThreads = (localResult as CommentThread[]) ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser:comment-sync] comment_list failed: ${msg} — skipping sync`);
    return "partial";
  }

  for (const remoteThread of remoteThreads) {
    if (remoteThread.deletedAt) continue;

    const existingThread = localThreads.find((t) => t.id === remoteThread.id);
    let localStatus: "open" | "resolved" = existingThread?.status ?? "open";
    const localCommentIds = getActiveLocalCommentIds(existingThread);

    if (!existingThread) {
      try {
        await bridge.invokeTool("comment_create", remoteThreadToCreateArgs(remoteThread));
        const firstCommentId = remoteThread.comments[0]?.id;
        if (firstCommentId) localCommentIds.add(firstCommentId);
        out.appendLine(`[accordo-browser:comment-sync] created thread ${remoteThread.id} on ${remoteThread.pageUrl}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(`[accordo-browser:comment-sync] comment_create failed for ${remoteThread.id}: ${msg}`);
      }
    }

    const remoteStatus = remoteThread.status;
    if (localStatus !== remoteStatus) {
      try {
        if (remoteStatus === "resolved") {
          await bridge.invokeTool("comment_resolve", { threadId: remoteThread.id, resolutionNote: "Synced from browser" });
        } else {
          await bridge.invokeTool("comment_reopen", { threadId: remoteThread.id });
        }
        localStatus = remoteStatus;
        out.appendLine(`[accordo-browser:comment-sync] synced status for thread ${remoteThread.id} → ${remoteStatus}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(`[accordo-browser:comment-sync] status sync failed for ${remoteThread.id}: ${msg}`);
      }
    }

    for (const remoteComment of remoteThread.comments) {
      if (remoteComment.deletedAt) continue;
      if (!localCommentIds.has(remoteComment.id)) {
        try {
          await bridge.invokeTool("comment_reply", remoteCommentToReplyArgs(remoteComment));
          localCommentIds.add(remoteComment.id);
          out.appendLine(`[accordo-browser:comment-sync] added reply ${remoteComment.id} to thread ${remoteThread.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          out.appendLine(`[accordo-browser:comment-sync] comment_reply failed for ${remoteComment.id}: ${msg}`);
        }
      }
    }

    if (existingThread) {
      await deleteMissingReplies(bridge, existingThread, remoteThread, (message) => out.appendLine(message));
    }
  }

  if (anyPageFailed) {
    out.appendLine("[accordo-browser:comment-sync] partial remote fetch — skipping deletions");
    return "partial";
  }

  for (const localThread of localThreads) {
    if (!remoteThreadIds.has(localThread.id)) {
      try {
        await bridge.invokeTool("comment_delete", { threadId: localThread.id });
        out.appendLine(`[accordo-browser:comment-sync] deleted local-only thread ${localThread.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(`[accordo-browser:comment-sync] comment_delete failed for ${localThread.id}: ${msg}`);
      }
    }
  }

  return anyPageFailed ? "partial" : "success";
}
