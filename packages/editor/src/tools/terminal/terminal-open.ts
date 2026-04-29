import * as vscode from "vscode";
import { errorMessage } from "../../util.js";
import { createTerminalId, trackTerminal } from "./terminal-state.js";

export async function terminalOpenHandler(
  args: Record<string, unknown>,
): Promise<{ terminalId: string; name: string } | { error: string }> {
  try {
    const terminalName = typeof args["name"] === "string" ? args["name"] : "Accordo";
    const cwd = resolveTerminalCwd(args);
    const terminal = vscode.window.createTerminal({ name: terminalName, cwd });
    terminal.show();

    const terminalId = createTerminalId();
    trackTerminal(terminalId, terminal);
    return { terminalId, name: terminalName };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function resolveTerminalCwd(args: Record<string, unknown>): string | undefined {
  if (typeof args["cwd"] === "string") {
    return args["cwd"];
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
