export const POLL_INTERVAL_MS = 100;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 30_000;

export interface WaitOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface WaitResult {
  met: boolean;
  matchedCondition?: string;
  elapsedMs: number;
  error?: "timeout" | "navigation-interrupted" | "page-closed";
}

export interface WaitProvider {
  waitForText(texts: string[], options: WaitOptions): Promise<WaitResult>;
  waitForSelector(selector: string, options: WaitOptions): Promise<WaitResult>;
  waitForStableLayout(stableMs: number, options: WaitOptions): Promise<WaitResult>;
}
