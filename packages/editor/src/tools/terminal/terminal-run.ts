import * as vscode from "vscode";
import type {
  TerminalObserveRequest,
  TerminalObservedSlice,
  TerminalRunHandler,
} from "../terminal-read/contracts.js";
import { errorMessage } from "../../util.js";
import {
  adoptTerminal,
  createTerminalId,
  getTerminal,
  trackTerminal,
} from "./terminal-state.js";
import {
  DEFAULT_TERMINAL_READ_MAX_CHARS,
  DEFAULT_TERMINAL_READ_MAX_LINES,
  DEFAULT_TERMINAL_OBSERVE_WAIT_MS,
  MAX_TERMINAL_READ_MAX_CHARS,
  MAX_TERMINAL_READ_MAX_LINES,
  TERMINAL_OBSERVE_POLL_MS,
} from "../terminal-read/contracts.js";

interface ResolvedRunTerminal {
  readonly terminal: vscode.Terminal;
  readonly terminalId: string;
}

// Shared observation pipeline — provided via initTerminalRunGateway
let observeDeps: {
  read(request: { terminalId: string; maxLines: number; maxChars: number; since?: string }): Promise<{ text: string; cursor: string; truncated: boolean }>;
  redact(text: string): string;
} | null = null;

// Source reference for terminal output capture
let terminalSource: {
  attachToTerminal(terminalId: string, terminal: vscode.Terminal): void;
  stopTrackingTerminal(terminalId: string): void;
} | null = null;

export function initTerminalRunGateway(
  deps: {
    read(request: { terminalId: string; maxLines: number; maxChars: number; since?: string }): Promise<{ text: string; cursor: string; truncated: boolean }>;
    redact(text: string): string;
  },
): void {
  observeDeps = deps;
}

export function initTerminalRunGatewaySource(
  source: { attachToTerminal(terminalId: string, terminal: vscode.Terminal): void; stopTrackingTerminal(terminalId: string): void },
): void {
  terminalSource = source;
}

export const terminalRunHandler: TerminalRunHandler = async (args) => {
  try {
    // 1. Validate command first (precedence order §S-TR-10)
    const command = validateRunCommand(args);
    if (!command) {
      return { error: "Argument 'command' must be a non-empty string" };
    }

    // 2. Parse observe parameters
    const observe = parseObserveParams(args);

    // 3. Validate observeMaxLines if observe is enabled (precedes terminal resolution)
    if ("error" in observe) return observe;

    // 4. Resolve terminal
    const requestedTerminalId = readRequestedTerminalId(args);
    const resolved = resolveRunTerminal(requestedTerminalId);
    if ("error" in resolved) {
      return resolved;
    }

    // 5. Dispatch command. VS Code's sendText is synchronous; observed runs
    // wait below for shell-integration output to reach the capture buffer.
    dispatchRunCommand(resolved.terminal, command);

    // 6. Optional: inline observe preview using shared pipeline
    if (observeDeps && observe.observeMaxLines > 0) {
      const preview = await collectObservePreview(
        resolved.terminalId,
        observe.observeMaxLines,
        observe.observeMaxChars,
      );
      return { sent: true, terminalId: resolved.terminalId, observe: preview };
    }

    return { sent: true, terminalId: resolved.terminalId };
  } catch (error) {
    return { error: errorMessage(error) };
  }
};

function validateRunCommand(args: Record<string, unknown>): string | undefined {
  const command = args["command"];
  return typeof command === "string" && command ? command : undefined;
}

function readRequestedTerminalId(
  args: Record<string, unknown>,
): string | undefined {
  return typeof args["terminalId"] === "string" ? args["terminalId"] : undefined;
}

/**
 * Parse observe parameters from args.
 * Returns either valid params or an error response.
 */
function parseObserveParams(
  args: Record<string, unknown>,
): { observeMaxLines: number; observeMaxChars: number } | { error: string } {
  const rawLines = args["observeMaxLines"];
  const observeMaxLines =
    typeof rawLines === "number" ? rawLines : 0;

  const rawChars = args["observeMaxChars"];
  const observeMaxChars =
    typeof rawChars === "number" ? rawChars : DEFAULT_TERMINAL_READ_MAX_CHARS;

  // observeMaxLines=0 (or omitted) → no preview, skip all observe validation
  if (observeMaxLines === 0) {
    return { observeMaxLines: 0, observeMaxChars: DEFAULT_TERMINAL_READ_MAX_CHARS };
  }

  // validate observeMaxLines (precedes terminal resolution per S-TR-10)
  if (
    !Number.isInteger(observeMaxLines) ||
    observeMaxLines < 1 ||
    observeMaxLines > MAX_TERMINAL_READ_MAX_LINES
  ) {
    return { error: `Argument 'observeMaxLines' must be 0 or an integer between 1 and ${MAX_TERMINAL_READ_MAX_LINES}` };
  }

  // validate observeMaxChars only when observeMaxLines > 0
  if (
    !Number.isInteger(observeMaxChars) ||
    observeMaxChars < 1 ||
    observeMaxChars > MAX_TERMINAL_READ_MAX_CHARS
  ) {
    return { error: `Argument 'observeMaxChars' must be an integer between 1 and ${MAX_TERMINAL_READ_MAX_CHARS}` };
  }

  return { observeMaxLines, observeMaxChars };
}

async function collectObservePreview(
  terminalId: string,
  maxLines: number,
  maxChars: number,
): Promise<TerminalObservedSlice> {
  if (!observeDeps) {
    return { text: "", cursor: "", truncated: false };
  }
  try {
    const deadline = Date.now() + DEFAULT_TERMINAL_OBSERVE_WAIT_MS;
    let raw = await observeDeps.read({ terminalId, maxLines, maxChars });

    while (!raw.text && Date.now() < deadline) {
      await delay(TERMINAL_OBSERVE_POLL_MS);
      raw = await observeDeps.read({ terminalId, maxLines, maxChars });
    }

    return { text: observeDeps.redact(raw.text), cursor: raw.cursor, truncated: raw.truncated };
  } catch {
    return { text: "", cursor: "", truncated: false };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRunTerminal(
  requestedTerminalId: string | undefined,
): ResolvedRunTerminal | { error: string } {
  if (requestedTerminalId) {
    return resolveTrackedRunTerminal(requestedTerminalId);
  }
  return resolveActiveOrNewRunTerminal();
}

function resolveTrackedRunTerminal(
  terminalId: string,
): ResolvedRunTerminal | { error: string } {
  const terminal = getTerminal(terminalId);
  if (!terminal) {
    return { error: `Terminal ${terminalId} not found` };
  }
  // S-TR-04/S-TR-09: attach output source for observe-capable terminals
  if (terminalSource) {
    terminalSource.attachToTerminal(terminalId, terminal);
  }
  return { terminal, terminalId };
}

function resolveActiveOrNewRunTerminal(): ResolvedRunTerminal {
  const activeTerminal = vscode.window.activeTerminal;
  if (activeTerminal) {
    const terminalId = adoptTerminal(activeTerminal);
    // S-TR-04/S-TR-09: attach output source for observe-capable terminals
    if (terminalSource) {
      terminalSource.attachToTerminal(terminalId, activeTerminal);
    }
    return { terminal: activeTerminal, terminalId };
  }

  const terminal = vscode.window.createTerminal({ name: "Accordo" });
  const terminalId = createTerminalId();
  trackTerminal(terminalId, terminal);
  // S-TR-04/S-TR-09: attach output source for observe-capable terminals
  if (terminalSource) {
    terminalSource.attachToTerminal(terminalId, terminal);
  }
  return { terminal, terminalId };
}

function dispatchRunCommand(terminal: vscode.Terminal, command: string): void {
  terminal.sendText(command, true);
  terminal.show();
}
