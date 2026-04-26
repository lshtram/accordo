/**
 * Runtime Directives — Re-export shim
 *
 * All canonical clause data, the production catalog, and the Phase A stub
 * have moved to the `runtime-directives/` sub-directory.
 *
 * Old import sites continue to work unchanged.
 *
 *   import { RuntimeDirectiveCatalogImpl, ... } from "./runtime-directives.js";
 *
 * New import sites should prefer the sub-module path:
 *
 *   import { RuntimeDirectiveCatalogImpl } from "./runtime-directives/catalog.js";
 *   import { CANONICAL_CLAUSES, CANONICAL_BUNDLE, ... } from "./runtime-directives/canonical-clauses.js";
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
} from "./runtime-directives/canonical-clauses.js";

export { RuntimeDirectiveCatalogImpl, createRuntimeDirectiveCatalog } from "./runtime-directives/catalog.js";

export { StubRuntimeDirectiveCatalog } from "./runtime-directives/stub.js";
