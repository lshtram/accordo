import type { AuditEntry } from "./audit-log.js";

export type AuditWriter = (result: AuditEntry["result"], errorMessage?: string) => void;

export function extractSoftError(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.success === "boolean") return undefined;
  if (!("error" in d)) return undefined;
  if ("met" in d) return undefined;
  return typeof d.error === "string" ? d.error : undefined;
}

export function shouldDenyGatewayCommand(
  toolName: string,
  toolArgs: Record<string, unknown>,
): string | undefined {
  if (toolName !== "accordo_vscode_command_execute") return undefined;
  const command = toolArgs["command"];
  if (typeof command !== "string") return undefined;
  if (!command.startsWith("accordo_")) return undefined;
  return `Command '${command}' is denied by policy`;
}
