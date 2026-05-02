/**
 * Anchor builder — converts tool input into CommentAnchor values.
 *
 * Source: comments-architecture.md §3.1, requirements-comments.md M38-CT-03
 */

import type {
  CommentAnchor,
  SurfaceCoordinates,
  SurfaceType,
  BlockCoordinates,
} from "@accordo/bridge-types";

/**
 * Build a CommentAnchor from tool input.
 *
 * Supports all anchor kinds:
 * - "text"    → text range anchor
 * - "file"    → file-level anchor
 * - "surface" → surface anchor with surfaceType + coordinates
 * - "browser" → sugar for surface anchor with surfaceType="browser"
 *
 * Source: comments-architecture.md §3.1, requirements-comments.md M38-CT-03
 */
export function buildAnchor(
  uri: string,
  input: Record<string, unknown>,
  modality?: string,
): CommentAnchor {
  const kind = input["kind"] as string;

  if (kind === "text") {
    const startLine = input["startLine"] as number;
    if (typeof startLine !== "number" || !Number.isFinite(startLine)) {
      throw new Error("startLine is required and must be a finite number for text anchors");
    }
    const endLine = (input["endLine"] as number | undefined) ?? startLine;
    return {
      kind: "text",
      uri,
      range: { startLine, startChar: 0, endLine, endChar: 0 },
      docVersion: 0,
    };
  }

  if (kind === "surface") {
    const surfaceType = (input["surfaceType"] as SurfaceType) ?? (modality as SurfaceType);
    const coordinates = input["coordinates"] as SurfaceCoordinates;
    if (!surfaceType) throw new Error("surfaceType is required for surface anchors");
    if (!coordinates) throw new Error("coordinates are required for surface anchors");
    if (surfaceType === "slide") {
      validateSlideCoordinates(coordinates);
    }
    return { kind: "surface", uri, surfaceType, coordinates };
  }

  if (kind === "browser") {
    return buildBrowserAnchor(uri, input);
  }

  // file-level anchor (default)
  return { kind: "file", uri };
}

function buildBrowserAnchor(uri: string, input: Record<string, unknown>): CommentAnchor {
  // Browser anchor is sugar for a surface anchor with surfaceType="browser".
  // If anchorKey is an explicit normalized pair ("x:y"), store normalized coordinates.
  // Otherwise, persist the anchorKey as canonical blockId to preserve element identity.
  const anchorKey = input["anchorKey"] as string | undefined;

  if (anchorKey) {
    const normalizedMatch = anchorKey.match(/^(-?\d*\.?\d+):(-?\d*\.?\d+)$/);
    if (normalizedMatch) {
      const x = parseFloat(normalizedMatch[1]);
      const y = parseFloat(normalizedMatch[2]);
      if (!isNaN(x) && !isNaN(y)) {
        return {
          kind: "surface",
          uri,
          surfaceType: "browser" as SurfaceType,
          coordinates: { type: "normalized", x, y },
        };
      }
    }

    const blockCoords: BlockCoordinates = {
      type: "block",
      blockId: anchorKey,
      blockType: inferBlockTypeFromAnchorKey(anchorKey),
    };
    return {
      kind: "surface",
      uri,
      surfaceType: "browser" as SurfaceType,
      coordinates: blockCoords,
    };
  }

  const coordinates: SurfaceCoordinates = { type: "normalized", x: 0.5, y: 0.5 };
  return {
    kind: "surface",
    uri,
    surfaceType: "browser" as SurfaceType,
    coordinates,
  };
}

function inferBlockTypeFromAnchorKey(anchorKey: string): BlockCoordinates["blockType"] {
  if (anchorKey.startsWith("heading:")) return "heading";
  if (anchorKey.startsWith("li:")) return "list-item";
  if (anchorKey.startsWith("pre:")) return "code-block";
  return "paragraph";
}

/**
 * Validate slide surface coordinates.
 * Requires: type === "slide", finite numeric slideIndex, finite numeric x and y.
 * x and y must be within 0..1 range (normalized position within slide).
 */
function validateSlideCoordinates(coords: SurfaceCoordinates): void {
  if (coords.type !== "slide") {
    throw new Error(
      "Slide coordinates must have type 'slide'. " +
      "Canonical shape: { type: 'slide', slideIndex: number, x: number, y: number } " +
      "where x and y are in the 0..1 range.",
    );
  }
  const slideCoords = coords as { type: string; slideIndex?: unknown; x?: unknown; y?: unknown };
  if (typeof slideCoords.slideIndex !== "number" || !Number.isFinite(slideCoords.slideIndex)) {
    throw new Error(
      "Slide coordinates require a finite numeric slideIndex. " +
      "Canonical shape: { type: 'slide', slideIndex: number, x: number, y: number }.",
    );
  }
  if (typeof slideCoords.x !== "number" || !Number.isFinite(slideCoords.x)) {
    throw new Error(
      "Slide coordinates require a finite numeric x (0..1). " +
      "Canonical shape: { type: 'slide', slideIndex: number, x: number, y: number }.",
    );
  }
  if (typeof slideCoords.y !== "number" || !Number.isFinite(slideCoords.y)) {
    throw new Error(
      "Slide coordinates require a finite numeric y (0..1). " +
      "Canonical shape: { type: 'slide', slideIndex: number, x: number, y: number }.",
    );
  }
  if (slideCoords.x < 0 || slideCoords.x > 1 || slideCoords.y < 0 || slideCoords.y > 1) {
    throw new Error(
      "Slide coordinates x and y must be within 0..1 range (normalized position within slide). " +
      "Canonical shape: { type: 'slide', slideIndex: number, x: number, y: number }.",
    );
  }
}
