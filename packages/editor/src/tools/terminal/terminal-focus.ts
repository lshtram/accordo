import * as vscode from "vscode";
import { errorMessage } from "../../util.js";

export async function terminalFocusHandler(
  _args: Record<string, unknown>,
): Promise<{ focused: true } | { error: string }> {
  try {
    await vscode.commands.executeCommand("workbench.action.terminal.focus");
    return { focused: true };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
