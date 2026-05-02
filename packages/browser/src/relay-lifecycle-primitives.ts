import type * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import type { SecurityConfig } from "./security/index.js";
import type { BrowserBridgeAPI } from "./types.js";
import { DEFAULT_REDACTION_PATTERNS } from "./security/index.js";
import { BrowserAuditLog } from "./security/audit-log.js";
import { generateRelayToken } from "./relay-auth.js";
import { ACCORDO_HOME_DIR, BROWSER_AUDIT_LOG_PATH, RELAY_PORT_FILE_PATH } from "./browser-paths.js";
import { RELAY_BASE_PORT, RELAY_HOST } from "./relay-transport-constants.js";
import { readSharedRelayInfo } from "./relay-discovery.js";

export { RELAY_BASE_PORT, RELAY_HOST } from "./relay-transport-constants.js";

export const EXTENSION_ID = "accordo.accordo-browser";

const TOKEN_KEY = "browserRelayToken";

export function findFreePort(startPort: number, host: string, maxTries = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port: number): void => {
      if (attempt++ >= maxTries) {
        reject(new Error(`No free port found in range ${startPort}–${startPort + maxTries - 1}`));
        return;
      }
      const server = net.createServer();
      server.once("error", () => {
        server.close();
        tryPort(port + 1);
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, host);
    };
    tryPort(startPort);
  });
}

export async function resolveRelayToken(context: vscode.ExtensionContext): Promise<string> {
  const toPromise = <T>(v: T | Promise<T> | { then(onfulfilled: (val: T) => void): void }): Promise<T> =>
    Promise.resolve(v as T);

  try {
    const stored = await toPromise(context.secrets.get(TOKEN_KEY));
    if (typeof stored === "string" && stored.trim().length > 0) {
      return stored.trim();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const fromGlobal = context.globalState.get<string>(TOKEN_KEY);
    if (typeof fromGlobal === "string" && fromGlobal.trim().length > 0) {
      console.warn(`[accordo-browser] WARN: SecretStorage unavailable — using globalState relay token (${msg})`);
      return fromGlobal.trim();
    }

    const fresh = generateRelayToken();
    try {
      await toPromise(context.globalState.update(TOKEN_KEY, fresh));
      console.warn(`[accordo-browser] WARN: SecretStorage unavailable — stored relay token in globalState (${msg})`);
    } catch (globalErr) {
      const globalMsg = globalErr instanceof Error ? globalErr.message : String(globalErr);
      console.warn(`[accordo-browser] WARN: SecretStorage and globalState unavailable — using ephemeral relay token (${msg}; ${globalMsg})`);
    }
    return fresh;
  }

  const fromGlobal = context.globalState.get<string>(TOKEN_KEY);
  if (typeof fromGlobal === "string" && fromGlobal.trim().length > 0) {
    try {
      await toPromise(context.secrets.store(TOKEN_KEY, fromGlobal.trim()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[accordo-browser] WARN: SecretStorage store failed during migration — using globalState token (${msg})`);
      return fromGlobal.trim();
    }
    try {
      await toPromise(context.globalState.update(TOKEN_KEY, undefined));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[accordo-browser] WARN: globalState cleanup failed after migration (${msg})`);
    }
    return fromGlobal.trim();
  }

  const fromSharedRelay = readReusableSharedRelayToken();
  if (fromSharedRelay !== undefined) {
    try {
      await toPromise(context.secrets.store(TOKEN_KEY, fromSharedRelay));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await toPromise(context.globalState.update(TOKEN_KEY, fromSharedRelay));
        console.warn(`[accordo-browser] WARN: SecretStorage unavailable for shared relay token — stored relay token in globalState (${msg})`);
      } catch (globalErr) {
        const globalMsg = globalErr instanceof Error ? globalErr.message : String(globalErr);
        console.warn(`[accordo-browser] WARN: SecretStorage and globalState unavailable for shared relay token — using shared relay token (${msg}; ${globalMsg})`);
      }
    }
    return fromSharedRelay;
  }

  const fresh = generateRelayToken();
  try {
    await toPromise(context.secrets.store(TOKEN_KEY, fresh));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await toPromise(context.globalState.update(TOKEN_KEY, fresh));
      console.warn(`[accordo-browser] WARN: SecretStorage unavailable for fresh token — stored relay token in globalState (${msg})`);
    } catch (globalErr) {
      const globalMsg = globalErr instanceof Error ? globalErr.message : String(globalErr);
      console.warn(`[accordo-browser] WARN: SecretStorage and globalState unavailable for fresh token — using ephemeral token (${msg}; ${globalMsg})`);
    }
    return fresh;
  }
  return fresh;
}

function readReusableSharedRelayToken(): string | undefined {
  const info = readSharedRelayInfo();
  const token = info?.token;
  if (typeof token !== "string") return undefined;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function writeRelayPort(port: number): void {
  try {
    fs.mkdirSync(ACCORDO_HOME_DIR, { recursive: true });
    fs.writeFileSync(RELAY_PORT_FILE_PATH, String(port), "utf8");
  } catch {
    // best-effort — failure must not block activation
  }
}

export function readRelayPort(): number | undefined {
  try {
    const raw = fs.readFileSync(RELAY_PORT_FILE_PATH, "utf8").trim();
    const port = Number.parseInt(raw, 10);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

export function getSecurityConfig(): SecurityConfig {
  return {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
    redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
    auditLog: new BrowserAuditLog({ filePath: BROWSER_AUDIT_LOG_PATH }),
    snapshotRetention: { maxAgeMs: 0 },
  };
}

export interface RelayServices {
  readonly context: vscode.ExtensionContext;
  readonly out: vscode.OutputChannel;
  readonly bridge: BrowserBridgeAPI;
  readonly token: string;
  readonly commentsAvailable: boolean;
}

export function wireRelayServices(opts: RelayServices): vscode.Disposable[] {
  void opts;
  return [];
}
