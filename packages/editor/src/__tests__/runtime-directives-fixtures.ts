/**
 * Runtime Directives — Canonical Clause Fixtures (Editor Package)
 *
 * Minimal mirror of hub canonical clauses for tool-description parity validation.
 * The authoritative source is packages/hub/src/__tests__/runtime-directives-fixtures.ts.
 * This file provides the same data for editor package tests without cross-package dependency.
 *
 * Requirements: requirements-runtime-directives.md Y-05, Y-09, Y-10, Y-13
 */

import type { RuntimeDirectiveClause } from "@accordo/bridge-types";

// Canonical clauses (mirrors hub fixture — must stay in sync)
export const CANONICAL_CLAUSES: readonly RuntimeDirectiveClause[] = [
  {
    id: "rd-001",
    summary: "Skill routing mandatory",
    instruction:
      "Before acting, map the user request to project skills. Use skill-tester for testing tasks, tdd-guide for TDD tasks, test-master for test generation, property-based-testing for invariants, debugging skill for failures.",
    requirementIds: ["Y-01", "Y-05", "Y-09"],
    parityTargets: ["initialize", "instructions", "tool-description"],
  },
  {
    id: "rd-002",
    summary: "MCP tool naming convention",
    instruction:
      "All MCP tools exposed via the gateway must use the accordo_<modality>_<action> prefix (e.g., accordo_editor_open, accordo_terminal_run).",
    requirementIds: ["Y-05", "Y-09"],
    parityTargets: ["initialize", "instructions", "tool-description"],
  },
  {
    id: "rd-003",
    summary: "Conventional commits",
    instruction: "Use conventional commits: feat:, fix:, docs:, refactor:, test:, chore:.",
    requirementIds: ["Y-01", "Y-05"],
    parityTargets: ["initialize", "instructions"],
  },
  {
    id: "rd-004",
    summary: "No VSCode imports in Hub packages",
    instruction:
      "Hub is editor-agnostic. Importing vscode in accordo-hub is a hard failure.",
    requirementIds: ["Y-01", "Y-05"],
    parityTargets: ["initialize", "instructions"],
  },
  {
    id: "rd-005",
    summary: "Security middleware first",
    instruction:
      "Security middleware comes first on every authenticated HTTP endpoint. No request reaches a handler without passing the auth layer.",
    requirementIds: ["Y-07", "Y-09"],
    parityTargets: ["initialize", "instructions", "diagnostics"],
  },
  {
    id: "rd-006",
    summary: "Runtime directives single source",
    instruction:
      "The RuntimeDirectiveCatalog is the single source of truth for runtime directives. All delivery surfaces must obtain directives from this catalog.",
    requirementIds: ["Y-01", "Y-02", "Y-03", "Y-06"],
    parityTargets: ["initialize", "instructions"],
  },
  {
    id: "rd-007",
    summary: "Runtime directives delivery receipt",
    instruction:
      "Every runtime directive delivery must be recorded as a receipt with session ID, agent hint, channel, bundle version, bundle digest, and timestamp.",
    requirementIds: ["Y-08"],
    parityTargets: ["initialize", "instructions", "diagnostics"],
  },
  {
    id: "rd-008",
    summary: "Runtime directives parity checking",
    instruction:
      "Runtime directive parity must be validated across all delivery surfaces: initialize, instructions, tool-description, and diagnostics.",
    requirementIds: ["Y-09", "Y-10", "Y-11"],
    parityTargets: ["initialize", "instructions", "diagnostics"],
  },
  {
    id: "rd-009",
    summary: "Runtime directives diagnostics endpoint",
    instruction:
      "The /runtime-directives/diagnostics endpoint provides publication metadata and delivery receipts for verification and debugging.",
    requirementIds: ["Y-06", "Y-07"],
    parityTargets: ["diagnostics"],
  },
  {
    id: "rd-010",
    summary: "Tool description canonical parity",
    instruction:
      "Tool descriptions must not contradict canonical runtime directives. They should reinforce mandatory behaviors defined in the catalog.",
    requirementIds: ["Y-05", "Y-12", "Y-13"],
    parityTargets: ["tool-description"],
  },
  {
    id: "rd-011",
    summary: "Self-contained directive instructions",
    instruction:
      "Runtime directive instructions must be self-contained and not reference repo-only resources like documentation files or internal tooling paths.",
    requirementIds: ["Y-04"],
    parityTargets: ["initialize", "instructions"],
  },
];

// Implemented runtime-doc references (Phase C target)
export const IMPLEMENTED_RUNTIME_DOCS = new Set<string>([
  "accordo://docs/tool-reference/vscode-command-gateway",
  "accordo://docs/troubleshooting/vscode-command-gateway",
]);
