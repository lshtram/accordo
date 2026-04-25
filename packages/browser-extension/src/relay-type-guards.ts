/**
 * relay-type-guards.ts — Type narrowing facade.
 *
 * @module
 */

export type { AnchorContext, ResolveBoundsResult } from "./relay-type-capture.js";
export {
  readAnchorContext,
  readBoundsLiteral,
  resolveBoundsFromMessage,
  toCapturePayload,
} from "./relay-type-capture.js";
export {
  readOptionalNumber,
  readOptionalString,
  readOptionalStringArray,
  readString,
} from "./relay-type-readers.js";
export {
  hasDataField,
  hasErrorField,
  isSnapshotEnvelope,
  toCaptureStoreRecord,
} from "./relay-type-snapshots.js";
