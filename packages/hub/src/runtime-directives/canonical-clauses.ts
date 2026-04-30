/**
 * Canonical Clause Definitions — Runtime Directives
 *
 * Single source of truth for all Priority X/Y mandatory directive clauses.
 * Every delivery surface (initialize, /instructions, tool-description, diagnostics)
 * must render from this catalog.
 *
 * Requirements: requirements-runtime-directives.md XY-01 – XY-13
 */

import type { RuntimeDirectiveClause, RuntimeDirectiveBundle, RuntimeDirectivePublication } from "@accordo/bridge-types";

// ── Clause definitions ────────────────────────────────────────────────────────

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

// ── Bundle constants ─────────────────────────────────────────────────────────

export const CANONICAL_BUNDLE_VERSION = "1.0.0";
export const CANONICAL_BUNDLE_DIGEST =
  "sha256:skill-router-v1";

// ── Canonical bundle ──────────────────────────────────────────────────────────

export const CANONICAL_BUNDLE: RuntimeDirectiveBundle = {
  version: CANONICAL_BUNDLE_VERSION,
  digest: CANONICAL_BUNDLE_DIGEST,
  clauses: CANONICAL_CLAUSES,
};

// ── Canonical publication ────────────────────────────────────────────────────

export const CANONICAL_PUBLICATION: RuntimeDirectivePublication = {
  bundle: CANONICAL_BUNDLE,
  ownership: {
    ownerPackage: "accordo-hub",
    ownerModule: "runtime-directives",
  },
};
