import { vi } from "vitest";
import { buildHealthTool, MAX_RECENT_ERRORS } from "../health-tool.js";
import type { HealthResponse } from "../health-tool.js";
import type { BrowserRelayLike } from "../types.js";

export { buildHealthTool, MAX_RECENT_ERRORS };
export type { HealthResponse };

export function createMockRelay(overrides?: Partial<{
  connected: boolean;
  debuggerUrl?: string;
  onError: (error: string) => void;
}>): BrowserRelayLike {
  return {
    request: vi.fn(),
    push: vi.fn(),
    isConnected: vi.fn(() => overrides?.connected ?? true),
    getDebuggerUrl: vi.fn(() => overrides?.debuggerUrl),
    onError: overrides?.onError,
  } as unknown as BrowserRelayLike;
}
