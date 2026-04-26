/**
 * Runtime Directives — Public API
 *
 * Re-exports all public types and implementations from sub-modules.
 * The canonical clauses, bundle, and publication live in ./canonical-clauses.ts.
 * The production catalog lives in ./catalog.ts.
 * The Phase A stub lives in ./stub.ts.
 */

export type {
  RuntimeDirectiveClause,
  RuntimeDirectiveBundle,
  RuntimeDirectiveDeliveryChannel,
  RuntimeDirectiveDeliveryReceipt,
  RuntimeDirectiveOwnership,
  RuntimeDirectivePublication,
  RuntimeDirectiveDiagnostics,
  RuntimeDirectiveReceiptRecorder,
  RuntimeDirectiveParityCheck,
  RuntimeDirectiveParityIssue,
  RuntimeDirectiveParityReport,
  RuntimeDirectiveParityValidator,
  RuntimeDirectiveCatalog,
} from "@accordo/bridge-types";

export {
  CANONICAL_CLAUSES,
  CANONICAL_BUNDLE_VERSION,
  CANONICAL_BUNDLE_DIGEST,
  CANONICAL_BUNDLE,
  CANONICAL_PUBLICATION,
} from "./canonical-clauses.js";

export { RuntimeDirectiveCatalogImpl, createRuntimeDirectiveCatalog } from "./catalog.js";

export { StubRuntimeDirectiveCatalog } from "./stub.js";
