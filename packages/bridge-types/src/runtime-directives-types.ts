import type { IDEState } from "./ide-types.js";
import type { ToolRegistration } from "./tool-types.js";

export type RuntimeDirectiveParityTarget =
  | "initialize"
  | "instructions"
  | "tool-description"
  | "diagnostics";

export type RuntimeDirectiveDeliveryChannel =
  | "initialize"
  | "instructions";

export interface RuntimeDirectiveClause {
  readonly id: string;
  readonly summary: string;
  readonly instruction: string;
  readonly requirementIds: readonly string[];
  readonly parityTargets: readonly RuntimeDirectiveParityTarget[];
}

export interface RuntimeDirectiveBundle {
  readonly version: string;
  readonly digest: string;
  readonly clauses: readonly RuntimeDirectiveClause[];
}

export interface RuntimeDirectiveDeliveryReceipt {
  readonly sessionId: string;
  readonly agent: string | null;
  readonly channel: RuntimeDirectiveDeliveryChannel;
  readonly bundleVersion: string;
  readonly bundleDigest: string;
  readonly deliveredAt: string;
}

export interface RuntimeDirectiveOwnership {
  readonly ownerPackage: "accordo-hub";
  readonly ownerModule: "runtime-directives";
}

export interface RuntimeDirectivePublication {
  readonly bundle: RuntimeDirectiveBundle;
  readonly ownership: RuntimeDirectiveOwnership;
}

export interface RuntimeDirectiveDiagnostics {
  readonly publication: RuntimeDirectivePublication;
  readonly receipts: readonly RuntimeDirectiveDeliveryReceipt[];
}

export interface RuntimeDirectiveReceiptRecorder {
  recordReceipt(receipt: RuntimeDirectiveDeliveryReceipt): void;
  listReceipts(): readonly RuntimeDirectiveDeliveryReceipt[];
}

export interface RuntimeDirectiveParityCheck {
  readonly surface: RuntimeDirectiveParityTarget | "runtime-doc";
  readonly reference: string;
  readonly clauseIds: readonly string[];
}

export interface RuntimeDirectiveParityIssue {
  readonly code: "missing-clause" | "missing-reference" | "contradictory-guidance";
  readonly message: string;
  readonly clauseId?: string;
  readonly surface: RuntimeDirectiveParityTarget | "runtime-doc";
  readonly reference: string;
}

export interface RuntimeDirectiveParityReport {
  readonly ok: boolean;
  readonly issues: readonly RuntimeDirectiveParityIssue[];
}

export interface RuntimeDirectiveParityValidator {
  validateParity(checks: readonly RuntimeDirectiveParityCheck[]): RuntimeDirectiveParityReport;
}

export interface RuntimeDirectiveCatalog {
  getBundle(): RuntimeDirectiveBundle;
  getPublication(): RuntimeDirectivePublication;
  renderInstructions(state: IDEState, tools: readonly ToolRegistration[]): string;
  recordReceipt(receipt: RuntimeDirectiveDeliveryReceipt): void;
  validateParity(
    checks: readonly RuntimeDirectiveParityCheck[],
  ): RuntimeDirectiveParityReport;
  getDiagnostics(): RuntimeDirectiveDiagnostics;
}
