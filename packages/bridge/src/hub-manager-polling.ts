/**
 * Health polling logic extracted from HubManager.
 *
 * Responsibilities:
 * - Retry loop with deadline and interval
 * - Cancellation support
 * - Health probe delegation
 *
 * Extracted per coding-guidelines.md §3.1 for modularity.
 */

/**
 * Callback-based health probe used by the polling loop.
 * Returns true when the Hub is healthy.
 */
export type HealthProbe = () => Promise<boolean>;

/**
 * LCM-07: Poll /health until Hub responds or timeout.
 *
 * @param pollCancelled  - Mutable flag set by the caller to cancel in-progress polls
 * @param maxWaitMs      - Maximum time to wait for a healthy response (default 10000)
 * @param intervalMs     - Time between probes (default 500)
 * @param probe          - Async function that returns true when Hub is healthy
 */
export async function pollHealth(
  pollCancelled: { value: boolean },
  maxWaitMs: number,
  intervalMs: number,
  probe: HealthProbe,
): Promise<boolean> {
  pollCancelled.value = false;
  const deadline = Date.now() + maxWaitMs;
  return pollLoop(pollCancelled, deadline, intervalMs, probe);
}

/**
 * Internal retry loop — kept separate so the outer pollHealth wrapper stays thin.
 */
async function pollLoop(
  pollCancelled: { value: boolean },
  deadline: number,
  intervalMs: number,
  probe: HealthProbe,
): Promise<boolean> {
  return new Promise((resolve) => {
    const attempt = (): void => {
      if (pollCancelled.value || Date.now() >= deadline) {
        resolve(false);
        return;
      }
      probe()
        .then((healthy) => {
          if (pollCancelled.value) { resolve(false); return; }
          if (healthy) {
            resolve(true);
          } else if (Date.now() < deadline) {
            setTimeout(attempt, intervalMs);
          } else {
            resolve(false);
          }
        })
        .catch(() => {
          if (pollCancelled.value) { resolve(false); return; }
          if (Date.now() < deadline) {
            setTimeout(attempt, intervalMs);
          } else {
            resolve(false);
          }
        });
    };
    setTimeout(attempt, intervalMs);
  });
}
