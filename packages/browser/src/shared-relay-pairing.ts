import type { IncomingMessage, ServerResponse } from "node:http";

/** Duration (ms) a pairing code is valid before it expires. */
export const PAIR_CODE_TTL_MS = 5 * 60 * 1000;

export function createPairCode(): { code: string; expiresAt: number } {
  const half = (): string =>
    Array.from({ length: 4 }, () => Math.floor(Math.random() * 10).toString()).join("");
  return {
    code: `${half()}-${half()}`,
    expiresAt: Date.now() + PAIR_CODE_TTL_MS,
  };
}

interface PairingHttpOptions {
  host: string;
  port: number;
  token: string;
  pairCode: string | null;
  pairCodeExpiry: number;
  issueCode: () => string;
  confirmCode: (candidate: string) => boolean;
}

export function handlePairingHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: PairingHttpOptions,
): boolean {
  const url = new URL(req.url ?? "/", `http://${options.host}:${options.port}`);
  const origin = typeof req.headers["origin"] === "string" ? req.headers["origin"] : "";
  const isAllowedOrigin = origin === "" || origin.startsWith("chrome-extension://");

  const json = (statusCode: number, body: Record<string, unknown>, allowOrigin?: string): void => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/pair/code" && req.method === "GET") {
    if (!isAllowedOrigin) {
      json(403, { error: "forbidden" });
      return true;
    }
    const code = options.issueCode();
    json(200, { code, expiresIn: PAIR_CODE_TTL_MS }, origin || undefined);
    return true;
  }

  if (url.pathname === "/pair/confirm" && req.method === "POST") {
    if (!isAllowedOrigin) {
      json(403, { error: "forbidden" });
      return true;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const candidate = parsed["code"];
        if (
          typeof candidate !== "string" ||
          options.pairCode === null ||
          Date.now() > options.pairCodeExpiry ||
          !options.confirmCode(candidate)
        ) {
          json(401, { error: "invalid-code" }, origin || undefined);
          return;
        }
        json(200, { token: options.token }, origin || undefined);
      } catch {
        json(400, { error: "bad-request" }, origin || undefined);
      }
    });
    return true;
  }

  return false;
}
