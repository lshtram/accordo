/**
 * Runtime Directive Catalog — Production Implementation
 *
 * Deterministic canonical catalog with in-memory receipt storage,
 * parity validation, diagnostics, and renderInstructions().
 *
 * Requirements: requirements-runtime-directives.md Y-01 – Y-13
 */

import type {
  IDEState,
  RuntimeDirectiveCatalog,
  RuntimeDirectiveDeliveryReceipt,
  RuntimeDirectiveDeliveryChannel,
  RuntimeDirectiveDiagnostics,
  RuntimeDirectiveParityCheck,
  RuntimeDirectiveParityIssue,
  RuntimeDirectiveParityReport,
  ToolRegistration,
} from "@accordo/bridge-types";

import {
  CANONICAL_BUNDLE,
  CANONICAL_PUBLICATION,
  CANONICAL_CLAUSES,
} from "./canonical-clauses.js";

// ── Implemented runtime-doc references ──────────────────────────────────────

const IMPLEMENTED_RUNTIME_DOCS: readonly string[] = [
  "accordo://skills/accordo",
  "accordo://skills/diagram",
  "accordo://skills/browser",
  "accordo://skills/presentation",
  "accordo://skills/walkthrough",
];

// ── Catalog implementation ────────────────────────────────────────────────────

/**
 * RuntimeDirectiveCatalogImpl — production catalog for Priority Y.
 *
 * Provides deterministic canonical clauses, in-memory receipt storage,
 * parity validation, diagnostics, and renderInstructions() output.
 */
export class RuntimeDirectiveCatalogImpl implements RuntimeDirectiveCatalog {
  private readonly _receipts: RuntimeDirectiveDeliveryReceipt[] = [];

  getBundle(): ReturnType<RuntimeDirectiveCatalog["getBundle"]> {
    return CANONICAL_BUNDLE;
  }

  getPublication(): ReturnType<RuntimeDirectiveCatalog["getPublication"]> {
    return CANONICAL_PUBLICATION;
  }

  renderInstructions(_state: IDEState, _tools: readonly ToolRegistration[]): string {
    const lines: string[] = [
      "## Runtime Directives",
      "",
      `version: ${CANONICAL_BUNDLE.version}`,
      `digest: ${CANONICAL_BUNDLE.digest}`,
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

  validateParity(checks: readonly RuntimeDirectiveParityCheck[]): RuntimeDirectiveParityReport {
    const issues: RuntimeDirectiveParityIssue[] = [];

    for (const check of checks) {
      for (const clauseId of check.clauseIds) {
        const clause = CANONICAL_CLAUSES.find((c) => c.id === clauseId);
        if (!clause) {
          issues.push({
            code: "missing-clause",
            message: `Clause "${clauseId}" not found in canonical catalog`,
            clauseId,
            surface: check.surface,
            reference: check.reference,
          });
        }
      }

      if (check.surface === "runtime-doc") {
        if (!IMPLEMENTED_RUNTIME_DOCS.includes(check.reference)) {
          issues.push({
            code: "missing-reference",
            message: `Runtime doc "${check.reference}" not in implemented set`,
            surface: check.surface,
            reference: check.reference,
          });
        }
      }
    }

    return { ok: issues.length === 0, issues };
  }

  getDiagnostics(): RuntimeDirectiveDiagnostics {
    return {
      publication: CANONICAL_PUBLICATION,
      receipts: [...this._receipts],
    };
  }
}

/**
 * Factory — create a new RuntimeDirectiveCatalogImpl instance.
 */
export function createRuntimeDirectiveCatalog(): RuntimeDirectiveCatalog {
  return new RuntimeDirectiveCatalogImpl();
}
