/**
 * Runtime Directives — Editor Tool Description: Runtime-Doc Reference Validation
 * Requirements: requirements-runtime-directives.md Y-10, Y-13
 *
 * API checklist:
  *   Tool description accordo://skills/* references [4 tests]
 *
 * Blocker 5 remediation: replaced heuristic external-URL check with
 * canonical-source-driven validation against IMPLEMENTED_RUNTIME_DOCS set.
 * Also validates stale reference detection using the canonical fixture set.
 *
 * Blocker 4 remediation: uses canonical fixture data to validate that
 * tool descriptions reference only implemented runtime-doc URIs.
 */

import { describe, it, expect } from "vitest";
import { editorTools } from "../tools/editor-definitions.js";
import {
  CANONICAL_CLAUSES,
  IMPLEMENTED_RUNTIME_DOCS,
} from "./runtime-directives-fixtures.js";

const RUNTIME_DOC_PATTERN = /accordo:\/\/skills\/[a-z-]+/gi;

// Canonical skill-resource reference clause (rd-010)
const REF_CLAUSE = CANONICAL_CLAUSES.find(c => c.id === "rd-010");

describe("Tool description skill-resource reference validation — Y-10, Y-13", () => {
  it("Y-10: Tool descriptions do not reference unimplemented skill-resource URIs", () => {
    // Any accordo://skills/* refs must point to real implemented MCP resources.
    for (const tool of editorTools) {
      const refs = tool.description.match(RUNTIME_DOC_PATTERN);
      if (refs && refs.length > 0) {
        // If references exist, each must be in the implemented set
        for (const ref of refs) {
          expect(IMPLEMENTED_RUNTIME_DOCS.has(ref)).toBe(true);
        }
      }
    }
  });

  it("Y-10: IMPLEMENTED_RUNTIME_DOCS is non-empty (canonical fixture for Phase C)", () => {
    expect(IMPLEMENTED_RUNTIME_DOCS.size).toBeGreaterThan(0);
  });

  it("Y-10: All implemented runtime-doc references follow accordo://skills/* pattern", () => {
    for (const ref of IMPLEMENTED_RUNTIME_DOCS) {
      expect(ref).toMatch(/^accordo:\/\/skills\//);
    }
  });

  it("Y-13: Tool description references are not stale (validate against canonical)", () => {
    // rd-010 clause covers runtime-doc references:
    // "Tool descriptions must not contradict canonical runtime directives."
    // A stale reference would contradict because it claims a doc exists that doesn't.
    expect(REF_CLAUSE).toBeDefined();

    // Validate that tool descriptions do not contain any accordo://skills/* refs
    // that are NOT in the implemented set — those would be stale claims.
    for (const tool of editorTools) {
      const refs = tool.description.match(RUNTIME_DOC_PATTERN) ?? [];
      for (const ref of refs) {
        expect(IMPLEMENTED_RUNTIME_DOCS.has(ref)).toBe(true);
      }
    }
  });

  it("Y-10: All editor tool descriptions have minimum actionable content (>10 chars)", () => {
    for (const tool of editorTools) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("Y-13: Tool descriptions do not contain https:// external URLs (potential stale refs)", () => {
    // External URLs that could become stale are not self-contained (cf. Y-04)
    for (const tool of editorTools) {
      expect(tool.description).not.toMatch(/https?:\/\//);
    }
  });
});
