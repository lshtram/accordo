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
 * Stub implementation to be replaced in Phase C.
 */
export class CommandBackedBrowserRelayHealthReader
implements BrowserRelayHealthReader {
  async readHealth(): Promise<BrowserRelayHealth> {
    throw new Error("not implemented");
  }
}
