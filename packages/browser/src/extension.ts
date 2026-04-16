import * as vscode from "vscode";
import {
  findFreePort,
  resolveRelayToken,
  writeRelayPort,
  getSecurityConfig,
  activateSharedRelay,
  activatePerWindowRelay,
} from "./relay-lifecycle.js";

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

  // SBR-F-050: Check the sharedRelay feature flag
  const sharedRelayEnabled = vscode.workspace
    .getConfiguration("accordo.browser")
    .get<boolean>("sharedRelay", true);

  if (sharedRelayEnabled) {
    await activateSharedRelay(context, out, bridge as never, token, true);
  } else {
    await activatePerWindowRelay(context, out, bridge as never, token, true);
  }

  out.appendLine("[accordo-browser] published modality state");
}

export function deactivate(): void {
  // no-op: relay disposed via subscriptions
}
