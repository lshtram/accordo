import { POLL_INTERVAL_MS } from "./wait-provider-types.js";

export function makeInterruptionPromise(): {
  promise: Promise<"navigation-interrupted" | "page-closed">;
  cleanup: () => void;
} {
  let resolve: (code: "navigation-interrupted" | "page-closed") => void;
  const promise = new Promise<"navigation-interrupted" | "page-closed">((res) => {
    resolve = res;
  });

  const onBeforeUnload = (): void => {
    resolve("navigation-interrupted");
  };

  const onPageHide = (e: PageTransitionEvent): void => {
    if (!e.persisted) resolve("page-closed");
    else resolve("navigation-interrupted");
  };

  window.addEventListener("beforeunload", onBeforeUnload, { once: true });
  window.addEventListener("pagehide", onPageHide, { once: true });

  return {
    promise,
    cleanup: (): void => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    },
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function racePollTick(
  interruptPromise: Promise<"navigation-interrupted" | "page-closed">,
): Promise<"tick" | "navigation-interrupted" | "page-closed"> {
  return Promise.race([
    delay(POLL_INTERVAL_MS).then(() => "tick" as const),
    interruptPromise,
  ]);
}
