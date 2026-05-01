import * as vscode from "vscode";
import { errorMessage } from "../../util.js";
import { createTerminalId, trackTerminal } from "./terminal-state.js";

// Source reference for terminal output capture — provided via initTerminalOpenGatewaySource
let terminalSource: {
  attachToTerminal(terminalId: string, terminal: vscode.Terminal): void;
} | null = null;

/**
 * Wire the production terminal output source into the open handler.
 * Must be called during extension activate (after createTerminalReadDeps).
 * Without this, manually typed commands in tool-opened terminals are not captured.
 */
export function initTerminalOpenGatewaySource(
  source: { attachToTerminal(terminalId: string, terminal: vscode.Terminal): void },
): void {
  terminalSource = source;
}

/** Test-only helper — resets the injected source back to null. */
export function _resetTerminalOpenGatewaySource(): void {
  terminalSource = null;
}

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

    // Attach output source so shell integration events (including manually typed
    // commands) are captured by the readback pipeline for this terminal.
    if (terminalSource) {
      terminalSource.attachToTerminal(terminalId, terminal);
    }

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
