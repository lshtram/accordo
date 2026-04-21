import type { WsClientEvents } from "./ws-client.js";
import type { CompositionDeps } from "./extension-composition-types.js";

export function makeWsClientEvents(deps: CompositionDeps): WsClientEvents {
  return {
    onConnected: (): void => {
      deps.bootstrap.connectionStatusEmitter.fire(true);
      deps.bootstrap.updateStatusBar();
    },
    onDisconnected: (): void => {
      deps.bootstrap.connectionStatusEmitter.fire(false);
      deps.bootstrap.updateStatusBar();
    },
    onAuthFailure: (): void => {
      deps.bootstrap.outputChannel.appendLine("[accordo-bridge] Auth failure — Hub credentials invalid");
      deps.bootstrap.connectionStatusEmitter.fire(false);
      deps.bootstrap.updateStatusBar();
      void deps.services.hubManager.restart();
    },
    onProtocolMismatch: (message: string): void => {
      deps.bootstrap.outputChannel.appendLine(`[accordo-bridge] Protocol mismatch: ${message}`);
      deps.bootstrap.connectionStatusEmitter.fire(false);
      deps.bootstrap.updateStatusBar();
    },
    onInvoke: (message): void => {
      deps.services.router.handleInvoke(message).catch((err: unknown) => {
        deps.bootstrap.outputChannel.appendLine(`[accordo-bridge] invoke error: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    onCancel: (message): void => { deps.services.router.handleCancel(message); },
    onGetState: (): void => {
      if (deps.state.wsClient !== null) deps.state.wsClient.sendStateSnapshot(deps.services.statePublisher.getState());
    },
  };
}
