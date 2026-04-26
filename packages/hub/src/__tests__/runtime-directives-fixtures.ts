/**
 * Runtime Directives — Canonical Clause Fixtures
 *
 * Shared deterministic fixtures for Phase B behavior tests.
 * These represent the canonical clause set that all parity checks
 * reference as the single source of truth.
 *
 * Requirements: requirements-runtime-directives.md Y-01, Y-05, Y-09, Y-11, Y-13
 */

import type {
  RuntimeDirectiveBundle,
  RuntimeDirectiveClause,
  RuntimeDirectivePublication,
  RuntimeDirectiveCatalog,
  RuntimeDirectiveDeliveryReceipt,
  RuntimeDirectiveDiagnostics,
  RuntimeDirectiveParityCheck,
  RuntimeDirectiveParityReport,
  IDEState,
  ToolRegistration,
} from "@accordo/bridge-types";

// ── Canonical clause definitions ─────────────────────────────────────────────

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

export const CANONICAL_BUNDLE_VERSION = "1.0.0";
export const CANONICAL_BUNDLE_DIGEST = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const CANONICAL_BUNDLE: RuntimeDirectiveBundle = {
  version: CANONICAL_BUNDLE_VERSION,
  digest: CANONICAL_BUNDLE_DIGEST,
  clauses: CANONICAL_CLAUSES,
};

export const CANONICAL_PUBLICATION: RuntimeDirectivePublication = {
  bundle: CANONICAL_BUNDLE,
  ownership: {
    ownerPackage: "accordo-hub",
    ownerModule: "runtime-directives",
  },
};

// ── Deterministic mock catalog ────────────────────────────────────────────────

/**
 * MockRuntimeDirectiveCatalog — deterministic Phase B mock.
 *
 * Returns fixture data instead of throwing "not implemented".
 * Use this in tests that need actual catalog behavior.
 */
export class MockRuntimeDirectiveCatalog implements RuntimeDirectiveCatalog {
  private _receipts: RuntimeDirectiveDeliveryReceipt[] = [];

  getBundle(): RuntimeDirectiveBundle {
    return CANONICAL_BUNDLE;
  }

  getPublication(): RuntimeDirectivePublication {
    return CANONICAL_PUBLICATION;
  }

  renderInstructions(_state: IDEState, _tools: readonly ToolRegistration[]): string {
    const lines = [
      "## Runtime Directives",
      "",
      `version: ${CANONICAL_BUNDLE_VERSION}`,
      `digest: ${CANONICAL_BUNDLE_DIGEST}`,
      "",
    ];
    for (const clause of CANONICAL_CLAUSES) {
      lines.push(`### ${clause.id}: ${clause.summary}`);
      lines.push("");
      lines.push(clause.instruction);
      lines.push("");
    }
    return lines.join("\n");
  }

  recordReceipt(receipt: RuntimeDirectiveDeliveryReceipt): void {
    this._receipts.push({ ...receipt });
  }

  listReceipts(): readonly RuntimeDirectiveDeliveryReceipt[] {
    return [...this._receipts];
  }

  validateParity(_checks: readonly RuntimeDirectiveParityCheck[]): RuntimeDirectiveParityReport {
    // Deterministic: always returns ok=true with no issues for Phase B
    return { ok: true, issues: [] };
  }

  getDiagnostics(): RuntimeDirectiveDiagnostics {
    return {
      publication: CANONICAL_PUBLICATION,
      receipts: [...this._receipts],
    };
  }
}

// ── Receipt fixtures ─────────────────────────────────────────────────────────

export function makeReceipt(overrides: Partial<RuntimeDirectiveDeliveryReceipt> = {}): RuntimeDirectiveDeliveryReceipt {
  return {
    sessionId: "test-session-001",
    agent: "test-agent/1.0",
    channel: "initialize",
    bundleVersion: CANONICAL_BUNDLE_VERSION,
    bundleDigest: CANONICAL_BUNDLE_DIGEST,
    deliveredAt: "2026-04-25T10:00:00.000Z",
    ...overrides,
  };
}

// ── IDE state fixture ────────────────────────────────────────────────────────

export const FIXTURE_IDE_STATE: IDEState = {
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

// ── Implemented runtime-doc references (Phase C target) ───────────────────────

/**
 * Set of implemented accordo://docs/* paths.
 * Phase C will add validation that tool descriptions reference only these.
 */
export const IMPLEMENTED_RUNTIME_DOCS = new Set<string>([
  "accordo://docs/tool-reference/vscode-command-gateway",
  "accordo://docs/troubleshooting/vscode-command-gateway",
]);
