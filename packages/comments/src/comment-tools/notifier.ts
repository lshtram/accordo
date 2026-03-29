/**
 * URI normalizer and comment UI notifier interfaces.
 *
 * Source: comments-architecture.md §6
 */

import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import type { CommentThread } from "@accordo/bridge-types";

// ── URI normalizer ────────────────────────────────────────────────────────────

/**
 * Normalize any agent-supplied URI string into a canonical `file:///abs/path` URI.
 *
 * Accepts three input forms:
 *   - `file:///abs/path/to/file.ts`  — already canonical, re-normalized for safety
 *   - `/abs/path/to/file.ts`          — absolute FS path → converted to file URI
 *   - `relative/path/to/file.ts`      — resolved against workspaceRoot, then file URI
 *
 * Exported for unit testing and agent helper use.
 */
export function normalizeCommentUri(input: string, workspaceRoot: string): string {
  if (input.startsWith("file://")) {
    try {
      return pathToFileURL(path.resolve(fileURLToPath(input))).href;
    } catch {
      return input; // malformed URI — pass through unchanged
    }
  }
  if (path.isAbsolute(input)) {
    return pathToFileURL(path.resolve(input)).href;
  }
  // relative path — resolve against workspace root
  const base = workspaceRoot || process.cwd();
  return pathToFileURL(path.resolve(base, input)).href;
}

// ── UI notifier interfaces ────────────────────────────────────────────────────

/**
 * Minimal interface for updating VS Code's native comment UI after store mutations.
 * Implemented by NativeComments in the extension; omitted (undefined) in tests.
 */
export interface CommentUINotifier {
  addThread(thread: CommentThread): void;
  updateThread(thread: CommentThread): void;
  removeThread(threadId: string): void;
}

/**
 * Fans out CommentUINotifier calls to multiple notifiers.
 * Used to attach secondary notifiers (e.g. browser relay push) without
 * modifying the primary NativeComments notifier.
 */
export class CompositeCommentUINotifier implements CommentUINotifier {
  private readonly _notifiers: CommentUINotifier[] = [];

  constructor(primary: CommentUINotifier) {
    this._notifiers.push(primary);
  }

  add(notifier: CommentUINotifier): { dispose(): void } {
    this._notifiers.push(notifier);
    return {
      dispose: () => {
        const i = this._notifiers.indexOf(notifier);
        if (i >= 0) this._notifiers.splice(i, 1);
      },
    };
  }

  addThread(thread: CommentThread): void {
    for (const n of this._notifiers) n.addThread(thread);
  }

  updateThread(thread: CommentThread): void {
    for (const n of this._notifiers) n.updateThread(thread);
  }

  removeThread(threadId: string): void {
    for (const n of this._notifiers) n.removeThread(threadId);
  }
}
