/**
 * M90-INS — Element Inspector facade
 *
 * Public exports for element inspection and DOM excerpt collection.
 *
 * @module
 */

import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import { resolveReportedAnchorMetadata } from "./anchor-resolution-metadata.js";
import { inspectResolvedElement } from "./element-inspector-detail.js";
import { resolveElement } from "./element-inspector-resolver.js";
import { getDomExcerpt } from "./dom-excerpt.js";
import type { InspectElementArgs, InspectElementResult } from "./element-inspector-types.js";

export { getDomExcerpt } from "./dom-excerpt.js";
export type {
  DomExcerptResult,
  ElementContext,
  ElementDetail,
  InspectElementArgs,
  InspectElementResult,
} from "./element-inspector-types.js";

export function inspectElement(args: InspectElementArgs): InspectElementResult {
  const envelope = captureSnapshotEnvelope("dom");
  const element = resolveElement(args);
  if (!element) return { ...envelope, found: false };

  const { detail, context } = inspectResolvedElement(element);
  const anchorMetadata = resolveReportedAnchorMetadata(args.anchorKey, element, envelope.snapshotId, args.creationSnapshotId);
  return {
    ...envelope,
    found: true,
    ...anchorMetadata,
    element: detail,
    context,
    visibilityConfidence: detail.visibleConfidence,
  };
}
