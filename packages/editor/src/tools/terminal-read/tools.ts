import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { wrapHandler } from "../../util.js";
import {
  DEFAULT_TERMINAL_READ_MAX_CHARS,
  DEFAULT_TERMINAL_READ_MAX_LINES,
  MAX_TERMINAL_READ_MAX_CHARS,
  MAX_TERMINAL_READ_MAX_LINES,
} from "./contracts.js";
import { terminalReadHandler } from "./stubs.js";

const terminalReadDescription = [
  "Read recent buffered output from a terminal.",
  "Output is redacted, bounded, and may be truncated.",
  `Defaults: ${DEFAULT_TERMINAL_READ_MAX_LINES} lines / ${DEFAULT_TERMINAL_READ_MAX_CHARS} chars.`,
  `Caps: ${MAX_TERMINAL_READ_MAX_LINES} lines / ${MAX_TERMINAL_READ_MAX_CHARS} chars.`,
  "Omit terminalId to use the active terminal.",
  "Cursor is opaque and must be replayed only for the same terminal.",
  "Read accordo://skills/accordo for terminal workflows.",
].join(" ");

export const terminalReadTools: ExtensionToolDefinition[] = [
  {
    name: "accordo_terminal_read",
    group: "terminal",
    description: terminalReadDescription,
    inputSchema: {
      type: "object",
      properties: {
        terminalId: {
          type: "string",
          description:
            "Stable accordo terminal ID. If omitted, uses the active terminal.",
        },
        since: {
          type: "string",
          description:
            "Opaque cursor from a previous terminal.read response. Reuse only with the same terminal.",
        },
        maxLines: {
          type: "number",
          description:
            `Maximum lines to return. Default ${DEFAULT_TERMINAL_READ_MAX_LINES}; cap ${MAX_TERMINAL_READ_MAX_LINES}.`,
        },
        maxChars: {
          type: "number",
          description:
            `Maximum characters to return. Default ${DEFAULT_TERMINAL_READ_MAX_CHARS}; cap ${MAX_TERMINAL_READ_MAX_CHARS}.`,
        },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_terminal_read", terminalReadHandler),
  },
];
