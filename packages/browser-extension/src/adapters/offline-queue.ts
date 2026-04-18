/**
 * A queued mutation stored in chrome.storage.local when the browser extension
 * is disconnected from the relay.
 * Source: consolidation-sequenced-plan-2026-04-16.md §P-4
 *
 * Note: CommentMutationKind is defined inline rather than imported from
 * @accordo/bridge-types because browser-extension does not declare that
 * dependency (avoids adding a new package dependency).
 */
export type CommentMutationKind = "created" | "replied" | "resolved" | "reopened" | "deleted";

export interface QueuedCommentMutation {
  /** Unique ID for deduplication — UUID generated at enqueue time */
  id: string;
  /** ISO 8601 enqueue timestamp */
  timestamp: string;
  /** The mutation operation */
  kind: CommentMutationKind;
  /** Thread ID targeted by the mutation */
  threadId: string;
  /** Comment ID (required for reply, optional for create) */
  commentId?: string;
  /** Full params passed to the relay action */
  params: Record<string, unknown>;
  /** Surface type at enqueue time */
  surfaceType?: string;
}

/**
 * Offline queue interface for comment mutations.
 * When the browser extension is disconnected from the relay (offline), mutations
 * are queued locally and replayed on reconnect.
 * Source: consolidation-sequenced-plan-2026-04-16.md §P-4
 */
export interface OfflineQueue {
  enqueue(op: QueuedCommentMutation): Promise<void>;
  drain(): Promise<QueuedCommentMutation[]>;
  clear(): Promise<void>;
}

const STORAGE_KEY = "offline_queue" as const;

/**
 * Factory function to create an OfflineQueue backed by chrome.storage.local.
 * Operations are stored as an array under the "offline_queue" key.
 */
export function createOfflineQueue(): OfflineQueue {
  return {
    async enqueue(op: QueuedCommentMutation): Promise<void> {
      const record = await chrome.storage.local.get(STORAGE_KEY);
      const queue: QueuedCommentMutation[] = record[STORAGE_KEY] ?? [];

      const mutation: QueuedCommentMutation = {
        ...op,
        id: op.id ?? crypto.randomUUID(),
        timestamp: op.timestamp ?? new Date().toISOString(),
      };

      queue.push(mutation);
      await chrome.storage.local.set({ [STORAGE_KEY]: queue });
    },

    async drain(): Promise<QueuedCommentMutation[]> {
      const record = await chrome.storage.local.get(STORAGE_KEY);
      const queue: QueuedCommentMutation[] = record[STORAGE_KEY] ?? [];

      // Sort by timestamp ascending (FIFO order)
      queue.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      // Clear the queue in storage
      await chrome.storage.local.set({ [STORAGE_KEY]: [] });

      return queue;
    },

    async clear(): Promise<void> {
      await chrome.storage.local.remove(STORAGE_KEY);
    },
  };
}
