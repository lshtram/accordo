/**
 * Priority Q — Browser relay health contract for navigation fallback messaging.
 *
 * Used by Comments Panel navigation to avoid false "relay disconnected" reports
 * when focus command dispatch fails for reasons unrelated to relay connectivity.
 */

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
      const result = await executeCommand("accordo_browser_health");
      if (typeof result === "object" && result !== null && "connected" in result) {
        return { connected: Boolean((result as { connected: boolean }).connected) };
      }
      return { connected: false };
    } catch {
      return { connected: false };
    }
  }
}

/** Wraps vscode.commands.executeCommand to allow unit testing */
async function executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vscode = require("vscode") as typeof import("vscode");
  return vscode.commands.executeCommand(command, ...args);
}