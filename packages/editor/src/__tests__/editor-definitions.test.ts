/**
 * Tests for src/tools/editor-definitions.ts — tool definition array
 *
 * Phase B — all tests fail RED against "not implemented" stubs.
 * This file tests the editorTools array exported from editor-definitions.ts.
 *
 * Exported API checklist (Phase B requirement):
 *   [ ] editorTools[] — all 11 tool definitions for modules 16+17
 */

import { describe, it, expect } from "vitest";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { editorTools } from "../tools/editor-definitions.js";

// ─────────────────────────────────────────────────────────────────────────────
// Structural tests
// ─────────────────────────────────────────────────────────────────────────────

describe("editorTools — structural", () => {
  it("DEF-01: editorTools has exactly 11 entries", () => {
    expect(editorTools).toHaveLength(11);
  });

  it("DEF-02: includes tool named 'accordo_editor_open'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_open");
  });

  it("DEF-03: includes tool named 'accordo_editor_close'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_close");
  });

  it("DEF-04: includes tool named 'accordo_editor_scroll'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_scroll");
  });

  it("DEF-05: includes tool named 'accordo_editor_split'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_split");
  });

  it("DEF-06: includes tool named 'accordo_editor_focus'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_focus");
  });

  it("DEF-07: includes tool named 'accordo_editor_reveal'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_reveal");
  });

  it("DEF-08: includes tool named 'accordo_editor_highlight'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_highlight");
  });

  it("DEF-09: includes tool named 'accordo_editor_clearHighlights'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_clearHighlights");
  });

  it("DEF-10: includes tool named 'accordo_editor_save'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_save");
  });

  it("DEF-11: includes tool named 'accordo_editor_saveAll'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_saveAll");
  });

  it("DEF-12: includes tool named 'accordo_editor_format'", () => {
    const names = editorTools.map((t) => t.name);
    expect(names).toContain("accordo_editor_format");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common field contract
// ─────────────────────────────────────────────────────────────────────────────

describe("editorTools — common fields", () => {
  it("DEF-13: all tools have group === 'editor'", () => {
    for (const tool of editorTools) {
      expect(tool.group).toBe("editor");
    }
  });

  it("DEF-14: all tools have dangerLevel === 'safe'", () => {
    for (const tool of editorTools) {
      expect(tool.dangerLevel).toBe("safe");
    }
  });

  it("DEF-15: all tools have inputSchema.type === 'object'", () => {
    for (const tool of editorTools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("DEF-16: all tools have a handler that is a function", () => {
    for (const tool of editorTools) {
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("DEF-17: all tools have required fields: name, description, inputSchema", () => {
    for (const tool of editorTools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("inputSchema");
    }
  });

  it("DEF-18: all inputSchema objects are valid JSON Schema (have properties object)", () => {
    for (const tool of editorTools) {
      expect(tool.inputSchema.properties).toBeDefined();
      expect(typeof tool.inputSchema.properties).toBe("object");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_open schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_open — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_open")!;

  it("DEF-19: inputSchema requires 'path' property", () => {
    expect(tool.inputSchema.required).toContain("path");
  });

  it("DEF-20: inputSchema has optional 'line' property", () => {
    expect(tool.inputSchema.properties).toHaveProperty("line");
  });

  it("DEF-21: inputSchema has optional 'column' property", () => {
    expect(tool.inputSchema.properties).toHaveProperty("column");
  });

  it("DEF-22: path property is type string", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["path"].type).toBe("string");
  });

  it("DEF-23: line property is type number", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["line"].type).toBe("number");
  });

  it("DEF-24: column property is type number", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["column"].type).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_scroll schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_scroll — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_scroll")!;

  it("DEF-25: inputSchema requires 'direction' property", () => {
    expect(tool.inputSchema.required).toContain("direction");
  });

  it("DEF-26: direction enum is ['up', 'down']", () => {
    const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props["direction"].enum).toEqual(["up", "down"]);
  });

  it("DEF-27: by property enum is ['line', 'page']", () => {
    const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props["by"].enum).toEqual(["line", "page"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_highlight schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_highlight — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_highlight")!;

  it("DEF-28: inputSchema requires ['path', 'startLine', 'endLine']", () => {
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(["path", "startLine", "endLine"]),
    );
  });

  it("DEF-29: path property is type string", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["path"].type).toBe("string");
  });

  it("DEF-30: startLine property is type number", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["startLine"].type).toBe("number");
  });

  it("DEF-31: endLine property is type number", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["endLine"].type).toBe("number");
  });

  it("DEF-32: color property is type string (optional)", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["color"].type).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_split schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_split — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_split")!;

  it("DEF-33: inputSchema requires 'direction' property", () => {
    expect(tool.inputSchema.required).toContain("direction");
  });

  it("DEF-34: direction enum is ['right', 'down']", () => {
    const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props["direction"].enum).toEqual(["right", "down"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_focus schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_focus — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_focus")!;

  it("DEF-35: inputSchema requires 'group' property", () => {
    expect(tool.inputSchema.required).toContain("group");
  });

  it("DEF-36: group property is type number", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["group"].type).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_reveal schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_reveal — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_reveal")!;

  it("DEF-37: inputSchema requires 'path' property", () => {
    expect(tool.inputSchema.required).toEqual(["path"]);
  });

  it("DEF-38: path property is type string", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["path"].type).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_clearHighlights schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_clearHighlights — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_clearHighlights")!;

  it("DEF-39: inputSchema has optional 'decorationId' property", () => {
    expect(tool.inputSchema.properties).toHaveProperty("decorationId");
  });

  it("DEF-40: decorationId property is type string", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["decorationId"].type).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_save schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_save — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_save")!;

  it("DEF-41: path is optional (not in required array)", () => {
    expect(tool.inputSchema.required ?? []).not.toContain("path");
  });

  it("DEF-42: path property is type string", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["path"].type).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_saveAll schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_saveAll — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_saveAll")!;

  it("DEF-43: inputSchema has empty required array", () => {
    expect(tool.inputSchema.required ?? []).toEqual([]);
  });

  it("DEF-44: inputSchema has empty properties object", () => {
    expect(Object.keys(tool.inputSchema.properties)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_format schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_format — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_format")!;

  it("DEF-45: path is optional (not in required array)", () => {
    expect(tool.inputSchema.required ?? []).not.toContain("path");
  });

  it("DEF-46: path property is type string", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["path"].type).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accordo_editor_close schema
// ─────────────────────────────────────────────────────────────────────────────

describe("accordo_editor_close — inputSchema", () => {
  const tool = editorTools.find((t) => t.name === "accordo_editor_close")!;

  it("DEF-47: path is optional (not in required array)", () => {
    expect(tool.inputSchema.required ?? []).not.toContain("path");
  });

  it("DEF-48: path property is type string", () => {
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props["path"].type).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler wrapping
// ─────────────────────────────────────────────────────────────────────────────

describe("editorTools — handler wrapping", () => {
  it("DEF-49: all handlers are wrapped (return Promise)", () => {
    for (const tool of editorTools) {
      const result = tool.handler({});
      expect(result).toBeInstanceOf(Promise);
    }
  });
});
