/**
 * Stub Runtime Directive Catalog — Phase A Stub
 *
 * Public contract exists so later phases can wire runtime delivery,
 * parity checks, and diagnostics without reshaping callers.
 *
 * @deprecated Use RuntimeDirectiveCatalogImpl or createRuntimeDirectiveCatalog()
 * in production code. Kept for backward compatibility with existing stub tests.
 */

import type {
  IDEState,
  RuntimeDirectiveCatalog,
  RuntimeDirectiveBundle,
  RuntimeDirectivePublication,
  RuntimeDirectiveDeliveryReceipt,
  RuntimeDirectiveDiagnostics,
  RuntimeDirectiveParityCheck,
  RuntimeDirectiveParityReport,
  ToolRegistration,
} from "@accordo/bridge-types";

export class StubRuntimeDirectiveCatalog implements RuntimeDirectiveCatalog {
  getBundle(): RuntimeDirectiveBundle {
    throw new Error("not implemented");
  }

  getPublication(): RuntimeDirectivePublication {
    throw new Error("not implemented");
  }

  renderInstructions(_state: IDEState, _tools: readonly ToolRegistration[]): string {
    throw new Error("not implemented");
  }

  recordReceipt(_receipt: RuntimeDirectiveDeliveryReceipt): void {
    throw new Error("not implemented");
  }

  validateParity(_checks: readonly RuntimeDirectiveParityCheck[]): RuntimeDirectiveParityReport {
    throw new Error("not implemented");
  }

  getDiagnostics(): RuntimeDirectiveDiagnostics {
    throw new Error("not implemented");
  }
}
