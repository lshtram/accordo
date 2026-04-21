import { WsClient } from "./ws-client.js";
import { BRIDGE_SECRET_KEY, scopedSecretKey } from "./project-identity.js";
import type { CompositionDeps } from "./extension-composition-types.js";
import { makeWsClientEvents } from "./extension-ws-client-events.js";

export function setupWsClient(deps: CompositionDeps, port: number): Promise<void> {
  const secretKey = scopedSecretKey(BRIDGE_SECRET_KEY, deps.bootstrap.config.projectId);
  return deps.bootstrap.secretStorage.get(secretKey).then((secret) => {
    const wsClient = new WsClient(
      port,
      secret ?? "",
      makeWsClientEvents(deps),
      () => deps.services.registry.getAllTools(),
      (msg: string) => deps.bootstrap.outputChannel.appendLine(msg),
    );
    deps.state.wsClient = wsClient;
    deps.services.sendBridge.sendSnapshot = (msg): void => { wsClient.sendStateSnapshot(msg.state); };
    deps.services.sendBridge.sendUpdate = (msg): void => { wsClient.sendStateUpdate(msg.patch); };
    deps.services.router.setSendResultFn((result) => wsClient.sendResult(result));
    deps.services.router.setSendCancelledFn((id, late) => wsClient.sendCancelled(id, late));
    deps.services.registry.setSendFunction((tools) => wsClient.sendToolRegistry(tools));
    deps.services.statePublisher.start();
    return wsClient.connect(deps.services.statePublisher.getState(), deps.services.registry.getAllTools()).catch((err: unknown) => {
      deps.bootstrap.outputChannel.appendLine(`[accordo-bridge] WsClient connect error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });
}
