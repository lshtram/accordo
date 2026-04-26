/**
 * Runtime Directives — Contract: Stub Behavior (not implemented)
 * Requirements: requirements-runtime-directives.md Y-01, Y-06, Y-08, Y-09
 *
 * API checklist:
 *   StubRuntimeDirectiveCatalog.getBundle() [1 test]
 *   StubRuntimeDirectiveCatalog.getPublication() [1 test]
 *   StubRuntimeDirectiveCatalog.renderInstructions() [1 test]
 *   StubRuntimeDirectiveCatalog.recordReceipt() [1 test]
 *   StubRuntimeDirectiveCatalog.validateParity() [1 test]
 *   StubRuntimeDirectiveCatalog.getDiagnostics() [1 test]
 */

import { describe, it, expect } from "vitest";
import type { IDEState, ToolRegistration } from "@accordo/bridge-types";
import { StubRuntimeDirectiveCatalog } from "../runtime-directives.js";

const FIXTURE_STATE: IDEState = {
  activeFile: null,
  activeFileLine: 1,
  activeFileColumn: 1,
  openEditors: [],
  openTabs: [],
  visibleEditors: [],
  workspaceFolders: [],
  activeTerminal: null,
  workspaceName: null,
  remoteAuthority: null,
  modalities: {},
};

const FIXTURE_RECEIPT = {
  sessionId: "test-session",
  agent: "test-agent",
  channel: "initialize" as const,
  bundleVersion: "1.0.0",
  bundleDigest: "abc123",
  deliveredAt: "2026-04-25T10:00:00.000Z",
};

describe("StubRuntimeDirectiveCatalog — stub throws (Y-01, Y-06, Y-08, Y-09)", () => {
  const catalog = new StubRuntimeDirectiveCatalog();

  it("Y-01: getBundle() throws 'not implemented'", () => {
    expect(() => catalog.getBundle()).toThrow("not implemented");
  });

  it("Y-06: getPublication() throws 'not implemented'", () => {
    expect(() => catalog.getPublication()).toThrow("not implemented");
  });

  it("Y-06: renderInstructions() throws 'not implemented'", () => {
    expect(() => catalog.renderInstructions(FIXTURE_STATE, [])).toThrow("not implemented");
  });

  it("Y-08: recordReceipt() throws 'not implemented'", () => {
    expect(() => catalog.recordReceipt(FIXTURE_RECEIPT)).toThrow("not implemented");
  });

  it("Y-09: validateParity() throws 'not implemented'", () => {
    expect(() => catalog.validateParity([])).toThrow("not implemented");
  });

  it("Y-06: getDiagnostics() throws 'not implemented'", () => {
    expect(() => catalog.getDiagnostics()).toThrow("not implemented");
  });
});
