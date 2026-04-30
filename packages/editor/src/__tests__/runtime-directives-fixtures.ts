/**
 * Runtime Directives — Canonical Clause Fixtures (Editor Package)
 *
 * Minimal mirror of hub canonical clauses for tool-description parity validation.
 * The authoritative source is packages/hub/src/__tests__/runtime-directives-fixtures.ts.
 * This file provides the same data for editor package tests without cross-package dependency.
 *
 * Requirements: requirements-runtime-directives.md XY-05, XY-09, XY-10, XY-13
 */

import type { RuntimeDirectiveClause } from "@accordo/bridge-types";

// Canonical clauses (mirrors hub fixture — must stay in sync)
export const CANONICAL_CLAUSES: readonly RuntimeDirectiveClause[] = [
  {
    id: "rd-001",
    summary: "Use MCP skill resources",
    instruction:
      "Accordo publishes MCP-readable skill resources. Before using a tool family, read the relevant resource: accordo://skills/accordo, accordo://skills/diagram, accordo://skills/browser, accordo://skills/presentation, or accordo://skills/walkthrough.",
    requirementIds: ["XY-01", "XY-02", "XY-03", "XY-04", "XY-05", "XY-06"],
    parityTargets: ["initialize", "instructions", "tool-description"],
  },
  {
    id: "rd-002",
    summary: "Prefer first-class tools",
    instruction:
      "Prefer first-class accordo_* tools. Use the generic VS Code command gateway only when no first-class Accordo tool fits the task.",
    requirementIds: ["XY-07", "XY-08", "XY-11"],
    parityTargets: ["initialize", "instructions", "tool-description"],
  },
  {
    id: "rd-003",
    summary: "Tool descriptions are pointers",
    instruction:
      "Tool descriptions provide only immediate preconditions and point to MCP skill resources for workflow details; the skill resources contain the procedural guidance.",
    requirementIds: ["XY-07", "XY-09", "XY-12", "XY-13"],
    parityTargets: ["initialize", "instructions"],
  },
  {
    id: "rd-010",
    summary: "Tool description skill references",
    instruction:
      "Tool descriptions must not contradict skill-router guidance. When they reference workflow guidance, they must use implemented accordo://skills/* resources.",
    requirementIds: ["XY-07", "XY-10", "XY-13"],
    parityTargets: ["tool-description"],
  },
];

// Implemented runtime-doc references (Phase C target)
export const IMPLEMENTED_RUNTIME_DOCS = new Set<string>([
  "accordo://skills/accordo",
  "accordo://skills/diagram",
  "accordo://skills/browser",
  "accordo://skills/presentation",
  "accordo://skills/walkthrough",
]);
