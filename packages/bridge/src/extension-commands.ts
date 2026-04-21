import type { CompositionDeps, Disposable } from "./extension-composition-types.js";
import { createShowStatusHandler } from "./extension-show-status.js";

export function registerCommands(
  deps: CompositionDeps,
  registerFn: (command: string, callback: (...args: unknown[]) => unknown) => Disposable,
): Disposable[] {
  return [
    registerFn("accordo.hub.restart", () => {
      deps.services.hubManager.restart().catch((err: unknown) => {
        deps.bootstrap.outputChannel.appendLine(`[accordo-bridge] restart error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }),
    registerFn("accordo.hub.showLog", () => { deps.bootstrap.outputChannel.show(true); }),
    registerFn("accordo.bridge.showStatus", createShowStatusHandler(deps)),
  ];
}
