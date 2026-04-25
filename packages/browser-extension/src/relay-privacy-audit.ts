export interface AuditLogEntry {
  auditId: string;
  timestamp: string;
  toolName: string;
  pageId: string;
  origin: string;
  action: "allowed" | "blocked";
  redacted: boolean;
  durationMs: number;
}

export class AuditStore {
  private readonly _entries: AuditLogEntry[] = [];

  log(entry: AuditLogEntry): void {
    this._entries.push(entry);
  }

  entries(): readonly AuditLogEntry[] {
    return [...this._entries];
  }

  clear(): void {
    this._entries.length = 0;
  }
}

export const auditStore = new AuditStore();

export function mintAuditId(): string {
  return crypto.randomUUID();
}

export function enrichWithAuditLog(opts: {
  auditId: string;
  toolName: string;
  pageId: string;
  origin: string;
  action: "allowed" | "blocked";
  redacted: boolean;
  durationMs: number;
  response: { auditId?: string };
}): void {
  opts.response.auditId = opts.auditId;
  auditStore.log({
    auditId: opts.auditId,
    timestamp: new Date().toISOString(),
    toolName: opts.toolName,
    pageId: opts.pageId,
    origin: opts.origin,
    action: opts.action,
    redacted: opts.redacted,
    durationMs: opts.durationMs,
  });
}
