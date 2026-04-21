import type { HubManagerEvents } from "./hub-manager.js";
import type { CompositionDeps } from "./extension-composition-types.js";
import { requestConfigSyncs } from "./extension-config-sync-seams.js";
import { setupWsClient } from "./extension-ws-client-setup.js";

export function buildHubManagerEvents(deps: CompositionDeps): HubManagerEvents {
  return {
    onHubReady: (port: number, token: string): void => {
      deps.state.currentHubPort = port;
      deps.state.currentHubToken = token ?? "";
      requestConfigSyncs(deps, port, deps.state.currentHubToken);
      setupWsClient(deps, port).then(() => {
        deps.bootstrap.updateStatusBar();
      }).catch((err: unknown) => {
        deps.bootstrap.outputChannel.appendLine(`[accordo-bridge] onHubReady error: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    onHubError: (error: Error): void => {
      deps.bootstrap.outputChannel.appendLine(`[accordo-bridge] Hub error: ${error.message}`);
      deps.bootstrap.connectionStatusEmitter.fire(false);
      deps.bootstrap.updateStatusBar();
    },
    onCredentialsRotated: (token: string, secret: string): void => {
      deps.state.currentHubToken = token;
      if (deps.state.wsClient !== null) {
        const ws = deps.state.wsClient as { updateSecret?: (value: string) => void };
        if (typeof ws.updateSecret === "function") ws.updateSecret(secret);
      }
      requestConfigSyncs(deps, deps.state.currentHubPort, token);
    },
  };
}
