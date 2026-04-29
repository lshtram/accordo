/**
 * terminal-read-registration.test.ts — Priority S Phase B · §S-TR-REG
 * accordo_terminal_read and accordo_terminal_run tool registration metadata
 *
 * Phase B PASS-ELIGIBLE-IN-B static/registration tests.
 * These test tool definition metadata (name, dangerLevel, idempotent, schema)
 * which are intentionally correct in Phase A stubs.
 *
 * Documented rationale (per test-plan §4 PASS-ELIGIBLE-IN-B register):
 *   "Phase A intentionally ships the public tool shell so registration/
 *    contract tests can pass before behavior exists."
 *
 * Exported API checklist:
 *   ✓ terminalReadTools[]    — S-TR-REG-01..05 (terminal_read registration)
 */

import { describe, it, expect } from "vitest";

import { terminalReadTools } from "../tools/terminal-read/index.js";

describe("terminalReadTools registration — S-TR-REG", () => {
  it("S-TR-REG-01: terminalReadTools exports exactly 1 tool definition", () => {
    expect(terminalReadTools).toHaveLength(1);
  });

  it("S-TR-REG-02: tool name is 'accordo_terminal_read'", () => {
    expect(terminalReadTools[0].name).toBe("accordo_terminal_read");
  });

  it("S-TR-REG-03: tool dangerLevel is 'safe'", () => {
    expect(terminalReadTools[0].dangerLevel).toBe("safe");
  });

  it("S-TR-REG-04: tool is idempotent", () => {
    expect(terminalReadTools[0].idempotent).toBe(true);
  });

  it("S-TR-REG-05: inputSchema accepts optional terminalId, since, maxLines, maxChars", () => {
    const schema = terminalReadTools[0].inputSchema;
    expect(schema.properties).toHaveProperty("terminalId");
    expect(schema.properties).toHaveProperty("since");
    expect(schema.properties).toHaveProperty("maxLines");
    expect(schema.properties).toHaveProperty("maxChars");
    expect(schema.required).toEqual([]);
  });
});
