import { captureScreenshot } from "./screenshot.js";
import { MESSAGE_TYPES } from "./constants.js";
import { getMergedThreads } from "./sw-comment-sync.js";
import type { RelayBridgeClient } from "./relay-bridge.js";
import type { SwMessage, SwResponse } from "./sw-router.js";

export async function handleExportAndFocusMessage(
  relayBridge: RelayBridgeClient,
  message: SwMessage,
): Promise<SwResponse | undefined> {
  const payload = message.payload as Record<string, unknown> | undefined;
  switch (message.type) {
    case MESSAGE_TYPES.EXPORT: {
      const tabId = (payload?.tabId as number | undefined) ?? 1;
      const url = (payload?.url as string | undefined) ?? "";
      const format = (payload?.format as "markdown" | "json" | undefined) ?? "markdown";
      try {
        const screenshotRecord = await captureScreenshot(tabId);
        const threads = await getMergedThreads(relayBridge, url);
        const { formatAsMarkdown } = await import("./exporter.js");
        let text: string;
        if (format === "json") {
          const filtered = threads.filter((t) => !t.deletedAt).map((t) => ({ ...t, comments: t.comments.filter((c) => !c.deletedAt) }));
          text = JSON.stringify({ url, exportedAt: new Date().toISOString(), threads: filtered, screenshot: screenshotRecord }, null, 2);
        } else {
          text = formatAsMarkdown({ url, exportedAt: new Date().toISOString(), threads, screenshot: screenshotRecord });
        }
        return { success: true, data: { text } };
      } catch {
        return { success: false, error: "export failed" };
      }
    }
    case MESSAGE_TYPES.FOCUS_THREAD: {
      const threadId = (payload?.threadId as string | undefined) ?? "";
      if (!threadId) return { success: false, error: "missing-thread-id" };
      try {
        const result = await relayBridge.send("focus_thread", { threadId }, 5000);
        return { success: result.success, error: result.error };
      } catch {
        return { success: false, error: "action-failed" };
      }
    }
    default:
      return undefined;
  }
}
