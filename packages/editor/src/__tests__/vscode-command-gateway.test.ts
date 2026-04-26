/**
 * Tests for vscode-command-gateway — tool registration and factory seam
 * Requirements: M75-VCG-01, M75-VCG-08 (requirements-editor.md §4.26, §4.28)
 *
 * Phase B — behavior tests fail against stubs until Phase C.
 */

import { describe, it, expect } from "vitest";
import { vscodeCommandTools } from "../tools/vscode-command-tools.ts";
import { createVscodeCommandGateway } from "../tools/vscode-command-stubs.ts";
import { buildDeps } from "./vscode-command-helpers.ts";

describe("vscodeCommandTools — M75-VCG-01 / M75-VCG-08", () => {
  it("M75-VCG-01: accordo_vscode_command_list is registered with safe dangerLevel", () => {
    const tool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_list");
    expect(tool).toBeDefined();
    expect(tool!.dangerLevel).toBe("safe");
    expect(tool!.idempotent).toBe(true);
    expect(tool!.requiresConfirmation).toBe(false);
  });

  it("M75-VCG-08: accordo_vscode_command_execute is registered with moderate dangerLevel", () => {
    const tool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_execute");
    expect(tool).toBeDefined();
    expect(tool!.dangerLevel).toBe("moderate");
    expect(tool!.idempotent).toBe(false);
  });

  it("M75-VCG-01: list tool has empty required array (no mandatory args)", () => {
    const tool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_list");
    expect(tool!.inputSchema.required).toEqual([]);
  });

  it("M75-VCG-08: execute tool requires [command]", () => {
    const tool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_execute");
    expect(tool!.inputSchema.required).toContain("command");
  });

  it("M75-VCG-01/08: all handlers are functions", () => {
    for (const tool of vscodeCommandTools) {
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("M75-VCG-01: list tool schema has query, includeInternal, offset, limit properties", () => {
    const tool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_list");
    const props = tool!.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["query"].type).toBe("string");
    expect(props["includeInternal"].type).toBe("boolean");
    expect(props["offset"].type).toBe("number");
    expect(props["limit"].type).toBe("number");
  });

  it("M75-VCG-08: execute tool schema has command:string, args:array, confirmation:object", () => {
    const tool = vscodeCommandTools.find((t) => t.name === "accordo_vscode_command_execute");
    const props = tool!.inputSchema.properties as Record<string, { type?: string; items?: unknown }>;
    expect(props["command"].type).toBe("string");
    expect(props["args"].type).toBe("array");
    expect(props["confirmation"].type).toBe("object");
  });
});

describe("createVscodeCommandGateway — M75-VCG-01 / M75-VCG-08", () => {
  it("M75-VCG-01/08: factory returns { listHandler, executeHandler }", () => {
    const deps = buildDeps();
    const gateway = createVscodeCommandGateway(deps);
    expect(gateway).toHaveProperty("listHandler");
    expect(gateway).toHaveProperty("executeHandler");
    expect(typeof gateway.listHandler).toBe("function");
    expect(typeof gateway.executeHandler).toBe("function");
  });

  it("M75-VCG-01/08: factory requires deps object with catalog, executor, policy, audit", () => {
    const deps = buildDeps();
    const gateway = createVscodeCommandGateway(deps);
    expect(gateway.listHandler).toBeDefined();
    expect(gateway.executeHandler).toBeDefined();
  });

  it("M75-VCG-01/08: calling factory twice returns distinct handler pairs", () => {
    const deps = buildDeps();
    const g1 = createVscodeCommandGateway(deps);
    const g2 = createVscodeCommandGateway(deps);
    expect(g1.listHandler).not.toBe(g2.listHandler);
    expect(g1.executeHandler).not.toBe(g2.executeHandler);
  });
});
