/**
 * Priority Q — Browser relay health contract for navigation fallback messaging.
 *
 * Used by Comments Panel navigation to avoid false "relay disconnected" reports
 * when focus command dispatch fails for reasons unrelated to relay connectivity.
 */

import * as vscode from "vscode";

export interface BrowserRelayHealth {
  readonly connected: boolean;
}

/**
 * Local abstraction for the browser health dependency.
 *
 * This keeps command-level details out of callers and allows tests to inject a
 * deterministic health source.
 */
export interface BrowserRelayHealthReader {
  readHealth(): Promise<BrowserRelayHealth>;
}

/**
 * Phase C implementation — calls accordo_browser_health via VS Code commands API.
 */
export class CommandBackedBrowserRelayHealthReader
implements BrowserRelayHealthReader {
  async readHealth(): Promise<BrowserRelayHealth> {
    try {
      const result = await vscode.commands.executeCommand("accordo_browser_health");
      if (typeof result === "object" && result !== null && "connected" in result) {
        return { connected: Boolean((result as { connected: boolean }).connected) };
      }
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }
}