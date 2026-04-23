import type * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SecurityConfig } from "./security/index.js";
import type { BrowserBridgeAPI } from "./types.js";
import { DEFAULT_REDACTION_PATTERNS } from "./security/index.js";
import { BrowserAuditLog } from "./security/audit-log.js";
import { generateRelayToken } from "./relay-auth.js";

export const EXTENSION_ID = "accordo.accordo-browser";
export const RELAY_BASE_PORT = 40111;
export const RELAY_HOST = "127.0.0.1";

const TOKEN_KEY = "browserRelayToken";

export function findFreePort(startPort: number, host: string, maxTries = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port: number) => {
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
    console.warn(`[accordo-browser] WARN: SecretStorage unavailable — using ephemeral relay token (${msg})`);
    return generateRelayToken();
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

  const fresh = generateRelayToken();
  try {
    await toPromise(context.secrets.store(TOKEN_KEY, fresh));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[accordo-browser] WARN: SecretStorage unavailable for fresh token — using ephemeral token (${msg})`);
    return fresh;
  }
  return fresh;
}

export function writeRelayPort(port: number): void {
  try {
    const dir = path.join(os.homedir(), ".accordo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "relay.port"), String(port), "utf8");
  } catch {
    // best-effort — failure must not block activation
  }
}

export function getSecurityConfig(): SecurityConfig {
  return {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
    redactionPolicy: { redactPatterns: DEFAULT_REDACTION_PATTERNS, replacement: "[REDACTED]" },
    auditLog: new BrowserAuditLog({ filePath: path.join(os.homedir(), ".accordo", "browser-audit.jsonl") }),
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
