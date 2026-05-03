import type * as vscode from "vscode";
import type { BrowserBridgeAPI, BrowserRelayLike } from "./types.js";
import { syncBrowserComments } from "./comment-sync-runtime.js";

/** Interval between periodic sync runs (milliseconds). */
export const SYNC_INTERVAL_MS = 30_000;

export class BrowserCommentSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private immediateSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private channelClosed = false;

  constructor(
    private readonly relay: BrowserRelayLike,
    private readonly bridge: BrowserBridgeAPI,
    private readonly out: vscode.OutputChannel,
  ) {}

  private log(message: string): void {
    if (this.channelClosed) return;
    try {
      this.out.appendLine(message);
    } catch {
      this.channelClosed = true;
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.log(`[accordo-browser:comment-sync] starting periodic sync every ${SYNC_INTERVAL_MS / 1000}s`);
    this.timer = setInterval(() => {
      void this.runSync();
    }, SYNC_INTERVAL_MS);
  }

  /**
   * Schedule an immediate sync after a short delay (default 200ms).
   *
   * Use this when the relay has just connected (e.g. after VS Code reload)
   * to prompt a sync without waiting for the next periodic interval.
   *
   * The delay gives the Chrome extension's relay-client-connected handler
   * time to complete before we send request_comment_state_sync.
   *
   * Idempotent — concurrent calls are deduplicated by the in-flight guard.
   *
   * @param delayMs  Delay before triggering sync (default 200ms)
   */
  scheduleImmediateSync(delayMs = 200): void {
    // Clear any pending immediate sync so rapid successive calls don't stack timers.
    if (this.immediateSyncTimer !== null) {
      clearTimeout(this.immediateSyncTimer);
      this.immediateSyncTimer = null;
    }
    this.immediateSyncTimer = setTimeout(() => {
      this.immediateSyncTimer = null;
      void this.syncNow();
    }, delayMs);
  }

  async syncNow(): Promise<void> {
    if (this.syncing) {
      this.log("[accordo-browser:comment-sync] sync already in-flight — skipping");
      return;
    }
    await this.runSync();
  }

  private async runSync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      this.log("[accordo-browser:comment-sync] starting sync...");
      const result = await syncBrowserComments(this.relay, this.bridge, this.out);
      this.log(`[accordo-browser:comment-sync] sync complete: ${result}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[accordo-browser:comment-sync] unexpected error: ${msg}`);
    } finally {
      this.syncing = false;
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.log("[accordo-browser:comment-sync] scheduler stopped");
    }
    if (this.immediateSyncTimer !== null) {
      clearTimeout(this.immediateSyncTimer);
      this.immediateSyncTimer = null;
    }
  }
}
