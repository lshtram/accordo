import * as vscode from "vscode";
import { errorMessage } from "../../util.js";
import { findTerminalId, getTerminal, terminalMap } from "./terminal-state.js";
import { terminalOutputBuffer } from "../terminal-read/runtime-buffer.js";

interface ResolvedCloseTarget {
  readonly terminal: vscode.Terminal;
  readonly terminalId: string;
}

export async function terminalCloseHandler(
  args: Record<string, unknown>,
): Promise<{ closed: true; terminalId: string } | { error: string }> {
  try {
    const resolved = resolveCloseTarget(args);
    if ("error" in resolved) {
      return resolved;
    }

    // S-TR-05: clear output buffer for the terminal before removing tracking
    await terminalOutputBuffer.clearTerminal(resolved.terminalId);
    terminalMap.delete(resolved.terminalId);
    resolved.terminal.dispose();
    return { closed: true, terminalId: resolved.terminalId };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function resolveCloseTarget(
  args: Record<string, unknown>,
): ResolvedCloseTarget | { error: string } {
  const terminalId = typeof args["terminalId"] === "string" ? args["terminalId"] : undefined;
  if (terminalId) {
    return resolveTrackedCloseTarget(terminalId);
  }

  const terminalName = typeof args["name"] === "string" ? args["name"] : undefined;
  if (!terminalName) {
    return { error: "Argument 'terminalId' or 'name' must be provided" };
  }
  return resolveNamedCloseTarget(terminalName);
}

function resolveTrackedCloseTarget(
  terminalId: string,
): ResolvedCloseTarget | { error: string } {
  const terminal = getTerminal(terminalId);
  if (!terminal) {
    return { error: `Terminal ${terminalId} not found` };
  }
  return { terminal, terminalId };
}

function resolveNamedCloseTarget(
  terminalName: string,
): ResolvedCloseTarget | { error: string } {
  const terminal = (vscode.window.terminals as vscode.Terminal[]).find(
    (candidate) => candidate.name === terminalName,
  );
  if (!terminal) {
    return { error: `Terminal with name '${terminalName}' not found` };
  }

  const existingId = findTerminalId(terminal);
  const terminalId = existingId ?? `(name:${terminalName})`;
  return { terminal, terminalId };
}
