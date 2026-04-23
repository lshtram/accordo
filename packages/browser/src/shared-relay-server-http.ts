import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SharedRelayServerOptions } from "./shared-relay-types.js";
import { handlePairingHttpRequest } from "./shared-relay-pairing.js";

interface PairingState {
  pairCode: string | null;
  pairCodeExpiry: number;
}

export function createSharedRelayHttpServer(
  options: SharedRelayServerOptions,
  pairingState: PairingState,
  issueCode: () => string,
  emit: (event: string, details?: Record<string, unknown>) => void,
) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (handlePairingHttpRequest(req, res, {
      host: options.host,
      port: options.port,
      token: options.token,
      pairCode: pairingState.pairCode,
      pairCodeExpiry: pairingState.pairCodeExpiry,
      issueCode,
      confirmCode: (candidate) => {
        if (candidate !== pairingState.pairCode) return false;
        pairingState.pairCode = null;
        pairingState.pairCodeExpiry = 0;
        emit("pair-confirmed");
        return true;
      },
    })) return;

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });
}
