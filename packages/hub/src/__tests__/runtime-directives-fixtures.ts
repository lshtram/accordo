/**
 * Runtime Directives — Canonical Clause Fixtures
 *
 * Shared deterministic fixtures for Phase B behavior tests.
 * These represent the canonical clause set that all parity checks
 * reference as the single source of truth.
 *
 * Requirements: requirements-runtime-directives.md XY-01, XY-05, XY-09, XY-11, XY-13
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

export const CANONICAL_BUNDLE_VERSION = "1.0.0";
export const CANONICAL_BUNDLE_DIGEST = "sha256:skill-router-v1";

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

// ── Implemented skill-resource references ─────────────────────────────────────

/**
 * Set of implemented accordo://skills/* paths.
 * Tool descriptions must reference only these MCP-readable skill resources.
 */
export const IMPLEMENTED_RUNTIME_DOCS = new Set<string>([
  "accordo://skills/accordo",
  "accordo://skills/diagram",
  "accordo://skills/browser",
  "accordo://skills/presentation",
  "accordo://skills/walkthrough",
]);
