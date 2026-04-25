import { makeInterruptionPromise, racePollTick } from "./wait-provider-runtime.js";
import type { WaitOptions, WaitResult } from "./wait-provider-types.js";

export async function waitForText(
  texts: string[],
  options: WaitOptions,
): Promise<WaitResult> {
  const { timeoutMs, signal } = options;
  const start = Date.now();
  const { promise: interruptPromise, cleanup } = makeInterruptionPromise();

  try {
    while (true) {
      if (signal?.aborted === true) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      const elapsed = Date.now() - start;
      const bodyText = document.body.innerText;
      for (const text of texts) {
        if (bodyText.includes(text)) {
          return { met: true, matchedCondition: text, elapsedMs: elapsed };
        }
      }
      if (elapsed >= timeoutMs) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      const raceResult = await racePollTick(interruptPromise);
      if (raceResult === "navigation-interrupted" || raceResult === "page-closed") {
        return { met: false, error: raceResult, elapsedMs: Date.now() - start };
      }
    }
  } finally {
    cleanup();
  }
}

export async function waitForSelector(
  selector: string,
  options: WaitOptions,
): Promise<WaitResult> {
  const { timeoutMs, signal } = options;
  const start = Date.now();
  const { promise: interruptPromise, cleanup } = makeInterruptionPromise();

  try {
    while (true) {
      if (signal?.aborted === true) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      const elapsed = Date.now() - start;
      if (document.querySelector(selector) !== null) {
        return { met: true, matchedCondition: selector, elapsedMs: elapsed };
      }
      if (elapsed >= timeoutMs) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      const raceResult = await racePollTick(interruptPromise);
      if (raceResult === "navigation-interrupted" || raceResult === "page-closed") {
        return { met: false, error: raceResult, elapsedMs: Date.now() - start };
      }
    }
  } finally {
    cleanup();
  }
}

export async function waitForStableLayout(
  stableMs: number,
  options: WaitOptions,
): Promise<WaitResult> {
  const { timeoutMs, signal } = options;
  const start = Date.now();
  const { promise: interruptPromise, cleanup } = makeInterruptionPromise();

  const captureLayoutFingerprint = (): string => {
    const scrollHeight = document.documentElement.scrollHeight;
    const rect = document.body.getBoundingClientRect();
    return `${scrollHeight}:${rect.width}:${rect.height}`;
  };

  let lastFingerprint = captureLayoutFingerprint();
  let stableStart = Date.now();

  try {
    while (true) {
      if (signal?.aborted === true) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      const raceResult = await racePollTick(interruptPromise);
      if (raceResult === "navigation-interrupted" || raceResult === "page-closed") {
        return { met: false, error: raceResult, elapsedMs: Date.now() - start };
      }

      const currentFingerprint = captureLayoutFingerprint();
      if (currentFingerprint !== lastFingerprint) {
        lastFingerprint = currentFingerprint;
        stableStart = Date.now();
      } else if (Date.now() - stableStart >= stableMs) {
        return { met: true, matchedCondition: "stable-layout", elapsedMs: Date.now() - start };
      }
    }
  } finally {
    cleanup();
  }
}
