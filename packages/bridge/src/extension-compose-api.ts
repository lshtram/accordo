import type { ExtensionToolDefinition, IDEState } from "@accordo/bridge-types";
import type { ComposedBridgeAPI, CompositionDeps, Disposable, ExtensionState } from "./extension-composition-types.js";
import { registerCommands } from "./extension-commands.js";

export function composeExtension(
  deps: CompositionDeps,
  registerCommandFn: (command: string, callback: (...args: unknown[]) => unknown) => Disposable,
): ComposedBridgeAPI {
  for (const disposable of registerCommands(deps, registerCommandFn)) deps.bootstrap.pushDisposable(disposable);
  deps.bootstrap.pushDisposable(deps.bootstrap.connectionStatusEmitter.event(() => { deps.bootstrap.updateStatusBar(); }));
  deps.services.hubManager.activate().catch((err: unknown) => {
    deps.bootstrap.outputChannel.appendLine(`[accordo-bridge] HubManager activation error: ${err instanceof Error ? err.message : String(err)}`);
  });
  return {
    registerTools: (extensionId, tools): Disposable => deps.services.registry.registerTools(extensionId, tools as unknown as ExtensionToolDefinition[]),
    publishState: (extensionId, stateData): void => { deps.services.statePublisher.publishState(extensionId, stateData); },
    getState: (): IDEState => deps.services.statePublisher.getState(),
    isConnected: (): boolean => deps.state.wsClient?.isConnected() ?? false,
    onConnectionStatusChanged: (listener): Disposable => deps.bootstrap.connectionStatusEmitter.event(listener),
    invokeTool: async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
      try {
        const handler = deps.services.registry.getHandler(toolName);
        if (typeof handler === "function") return await handler(args);
      } catch {
        // ignore
      }
      return null;
    },
  };
}

export async function cleanupExtension(state: ExtensionState, services: CompositionDeps["services"]): Promise<void> {
  await services.hubManager.softDisconnect().catch(() => {});
  if (state.wsClient !== null) {
    await state.wsClient.disconnect();
    state.wsClient = null;
  }
  services.router.cancelAll();
  services.statePublisher.dispose();
  services.registry.dispose();
}
