import * as vscode from "vscode";
import { errorMessage } from "../../util.js";
import { findTerminalId, reconcileTrackedTerminals } from "./terminal-state.js";

export interface TerminalInfo {
  readonly terminalId: string;
  readonly name: string;
  readonly isActive: boolean;
}

export async function terminalListHandler(
  _args: Record<string, unknown>,
): Promise<{ terminals: TerminalInfo[] } | { error: string }> {
  try {
    reconcileTrackedTerminals();
    const activeTerminal = vscode.window.activeTerminal;
    const terminals = vscode.window.terminals.map((terminal) => ({
      terminalId: findTerminalId(terminal) ?? "(untracked)",
      name: terminal.name,
      isActive: terminal === activeTerminal,
    }));
    return { terminals };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
