import * as vscode from "vscode";
import { terminalMap } from "./terminal-state.js";
import { terminalOutputBuffer } from "../terminal-read/runtime-buffer.js";
import { vscodeTerminalOutputSource } from "../terminal-read/vscode-terminal-source.js";

/** Register stale-entry cleanup for closed terminals. */
export function registerTerminalLifecycle(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(async (closed) => {
      for (const [id, terminal] of terminalMap) {
        if (terminal === closed) {
          // S-TR-05: clear output buffer and stop source tracking when terminal closes
          await terminalOutputBuffer.clearTerminal(id);
          vscodeTerminalOutputSource.handleTerminalClose(id);
          terminalMap.delete(id);
          break;
        }
      }
    }),
  );
}
