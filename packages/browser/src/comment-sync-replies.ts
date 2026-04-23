import type { CommentThread } from "@accordo/bridge-types";
import type { BrowserBridgeAPI } from "./types.js";
import type { RemoteBrowserThread } from "./comment-sync-types.js";

export function getActiveLocalCommentIds(thread?: CommentThread): Set<string> {
  return new Set(thread?.comments.map((comment) => comment.id) ?? []);
}

export function getActiveRemoteCommentIds(thread: RemoteBrowserThread): Set<string> {
  return new Set(thread.comments.filter((comment) => !comment.deletedAt).map((comment) => comment.id));
}

export async function deleteMissingReplies(
  bridge: BrowserBridgeAPI,
  localThread: CommentThread,
  remoteThread: RemoteBrowserThread,
  log: (message: string) => void,
): Promise<void> {
  const remoteCommentIds = getActiveRemoteCommentIds(remoteThread);
  for (const localComment of localThread.comments) {
    const isThreadRootComment = localComment.id === localThread.id || localComment.id === remoteThread.id;
    if (isThreadRootComment || remoteCommentIds.has(localComment.id)) {
      continue;
    }
    try {
      await bridge.invokeTool("comment_delete", { threadId: remoteThread.id, commentId: localComment.id });
      log(`[accordo-browser:comment-sync] deleted local-only reply ${localComment.id} from thread ${remoteThread.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[accordo-browser:comment-sync] comment_delete failed for reply ${localComment.id}: ${msg}`);
    }
  }
}
