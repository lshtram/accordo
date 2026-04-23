import type * as vscode from "vscode";
import type { BrowserBridgeAPI, BrowserRelayLike } from "./types.js";
import { syncBrowserComments } from "./comment-sync-runtime.js";

/** Interval between periodic sync runs (milliseconds). */
export const SYNC_INTERVAL_MS = 30_000;

export class BrowserCommentSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;

  constructor(
    private readonly relay: BrowserRelayLike,
    private readonly bridge: BrowserBridgeAPI,
    private readonly out: vscode.OutputChannel,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.out.appendLine(`[accordo-browser:comment-sync] starting periodic sync every ${SYNC_INTERVAL_MS / 1000}s`);
    this.timer = setInterval(() => {
      void this.runSync();
    }, SYNC_INTERVAL_MS);
  }

  async syncNow(): Promise<void> {
    if (this.syncing) {
      this.out.appendLine("[accordo-browser:comment-sync] sync already in-flight — skipping");
      return;
    }
    await this.runSync();
  }

  private async runSync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      this.out.appendLine("[accordo-browser:comment-sync] starting sync...");
      const result = await syncBrowserComments(this.relay, this.bridge, this.out);
      this.out.appendLine(`[accordo-browser:comment-sync] sync complete: ${result}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.out.appendLine(`[accordo-browser:comment-sync] unexpected error: ${msg}`);
    } finally {
      this.syncing = false;
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.out.appendLine("[accordo-browser:comment-sync] scheduler stopped");
    }
  }
}
