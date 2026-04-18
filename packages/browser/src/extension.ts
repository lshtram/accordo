import * as vscode from "vscode";
import {
  findFreePort,
  resolveRelayToken,
  writeRelayPort,
  getSecurityConfig,
  activateSharedRelay,
  activatePerWindowRelay,
} from "./relay-lifecycle.js";
import { handleBrowserCommentAction } from "./browser-comment-relay-handler.js";

// Re-export BrowserCommentSyncScheduler from comment-sync.ts for backward
// compatibility with existing consumers / tests.
export {
  BrowserCommentSyncScheduler,
  syncBrowserComments,
  SYNC_INTERVAL_MS,
} from "./comment-sync.js";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel("Accordo Browser Relay");
  context.subscriptions.push(out);
  out.appendLine("[accordo-browser] activating...");

  const bridgeExt = vscode.extensions.getExtension("accordo.accordo-bridge");
  if (!bridgeExt) {
    out.appendLine("[accordo-browser] accordo-bridge not installed; aborting activation");
    return;
  }
  const bridge = bridgeExt.exports as {
    registerTools: (...args: unknown[]) => unknown;
    publishState: (...args: unknown[]) => void;
    invokeTool: (...args: unknown[]) => unknown;
  } | undefined;
  if (!bridge || typeof bridge.registerTools !== "function") {
    out.appendLine("[accordo-browser] Bridge exports unavailable; aborting activation");
    return;
  }

  const token = await resolveRelayToken(context);

  // ── accordo_browser.focusThread command ─────────────────────────────────────
  // Q-2: Registered BEFORE the relay activates so it can handle incoming requests.
  // Focuses the Comments Panel and scrolls to / highlights the target thread.
  const focusThreadDisposable = vscode.commands.registerCommand(
    "accordo_browser.focusThread",
    async (threadId: string) => {
      // Show the Comments Panel if it is hidden.
      try {
        // Try the custom accordo-comments-panel view first.
        await vscode.commands.executeCommand("accordo-comments-panel.focus");
      } catch {
        // Fall back to VS Code's built-in Comments panel toggle.
        try {
          await vscode.commands.executeCommand("workbench.action.comments.toggle");
        } catch {
          // Neither panel available — non-fatal.
        }
      }

      // Delegate to accordo-comments if it exposes focusThread.
      const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
      if (commentsExt?.exports && typeof (commentsExt.exports as Record<string, unknown>)["focusThread"] === "function") {
        await (commentsExt.exports as { focusThread(threadId: string): Promise<void> }).focusThread(threadId);
      } else {
        out.appendLine("[accordo-browser] accordo-comments focusThread not available — panel focused but thread scroll skipped");
      }
    },
  );
  context.subscriptions.push(focusThreadDisposable);
  out.appendLine("[accordo-browser] registered accordo_browser.focusThread");

  // SBR-F-050: Check the sharedRelay feature flag
  const sharedRelayEnabled = vscode.workspace
    .getConfiguration("accordo.browser")
    .get<boolean>("sharedRelay", true);

  if (sharedRelayEnabled) {
    await activateSharedRelay(context, out, bridge as never, token, true, handleBrowserCommentAction);
  } else {
    await activatePerWindowRelay(context, out, bridge as never, token, true);
  }

  out.appendLine("[accordo-browser] published modality state");
}

export function deactivate(): void {
  // no-op: relay disposed via subscriptions
}
