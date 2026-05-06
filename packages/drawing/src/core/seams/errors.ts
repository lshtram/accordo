/**
 * DRW-R24 — Stable error vocabulary for accordo-drawing.
 *
 * Source: docs/20-requirements/requirements-drawing.md §7 (DRW-R24, DRW-R25)
 * Source: docs/10-architecture/drawing-architecture.md §3.1
 */

/** DRW-R24 — Stable error vocabulary. */
export type DrawingErrorCode =
  | "invalid-argument"
  | "path-outside-workspace"
  | "file-not-found"
  | "already-exists"
  | "unsupported-diagram-type"
  | "source-parse-failed"
  | "scene-parse-failed"
  | "scene-invalid"
  | "duplicate-managed-identity"
  | "panel-not-open"
  | "placement-failed"
  | "render-failed"
  | "invariant-violation";

/** DRW-R24 — Error class with stable machine-readable code. */
export class DrawingError extends Error {
  constructor(
    public readonly code: DrawingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DrawingError";
  }
}