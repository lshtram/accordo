/**
 * DRW-R03, DRW-R08..R10 — Scene index types and builder.
 *
 * The .excalidraw file owns positions, sizes, and unmanaged elements.
 * This seam classifies parsed elements into active/orphaned/unmanaged buckets
 * and detects duplicate managed identities.
 *
 * Source: docs/20-requirements/requirements-drawing.md §3 (DRW-R03, R08..R10)
 * Source: docs/10-architecture/drawing-architecture.md §3.2, §4.2
 * Requirements: DRW-R03, DRW-R08, DRW-R10
 */

import { DrawingError } from "./errors.js";

// ── Local type definitions (avoid circular imports with types.ts) ───────────────

/**
 * DRW-R05 — Stable identity anchor (defined here to avoid circular imports).
 * identity is a Mermaid node ID (e.g. "A") or edge key (e.g. "A->B:0").
 */
export interface ManagedIdentity {
  version: 1;
  entityKind: "node" | "edge" | "cluster" | "helper";
  identity: string;
  sceneRole: "primary" | "label" | "container" | "helper";
  sourcePath: string;      // workspace-relative .mmd path
  status: "active" | "orphaned";
  orphanReason?: string;   // present when status === "orphaned"
  /** Internal: label text captured from excalidraw text elements at merge time. */
  __label?: string;
}

/**
 * DRW-R03 — The .excalidraw file owns positions, sizes, unmanaged elements.
 * activeManaged: customData.accordo.status === "active"
 * orphanedManaged: customData.accordo.status === "orphaned" or malformed/duplicate
 * unmanaged: no customData.accordo at all
 */
export interface SceneIndex {
  activeManaged: SceneElement[];
  orphanedManaged: SceneElement[];
  unmanaged: SceneElement[];
}

/** A single element from a parsed .excalidraw JSON. */
export interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[][];
  customData?: {
    accordo?: ManagedIdentity;
    [key: string]: unknown;
  };
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * DRW-R03 — Index a parsed .excalidraw JSON into a SceneIndex.
 *
 * Classification rules (slice 1):
 * - No customData.accordo → unmanaged (freehand drawings, text, etc.)
 * - Malformed accordo (missing required fields) → orphaned with orphanReason
 * - Valid accordo with duplicate (entityKind, identity, sceneRole) tuple →
 *   all duplicates orphaned with "duplicate-managed-identity"
 * - Otherwise → activeManaged
 *
 * DRW-R10: orphan (don't silently delete) malformed or duplicate elements.
 */
export function buildSceneIndex(sceneJson: unknown): SceneIndex {
  const elements = (sceneJson as { elements?: unknown[] })?.elements ?? [];
  if (!Array.isArray(elements)) {
    throw new DrawingError("scene-parse-failed", "scene JSON has no elements array");
  }

  const activeManaged: SceneElement[] = [];
  const orphanedManaged: SceneElement[] = [];
  const unmanaged: SceneElement[] = [];

  // Track (entityKind, identity, sceneRole) tuples for deduplication
  const tupleToElements = new Map<string, SceneElement[]>();

  for (const el of elements) {
    const element = el as SceneElement;
    if (!element || typeof element !== "object") continue;

    const accordo = element.customData?.accordo;
    if (!accordo) {
      unmanaged.push(element);
      continue;
    }

    // Validate required fields (DRW-R05)
    if (!isValidManagedIdentity(accordo)) {
      const orphaned = cloneWithOrphan(element, "malformed-identity-missing");
      orphanedManaged.push(orphaned);
      continue;
    }

    // Check for duplicates before adding to active
    const tupleKey = `${accordo.entityKind}::${accordo.identity}::${accordo.sceneRole}`;
    if (!tupleToElements.has(tupleKey)) tupleToElements.set(tupleKey, []);
    tupleToElements.get(tupleKey)!.push(element);
  }

  // Distribute based on deduplication
  for (const [, els] of tupleToElements) {
    if (els.length > 1) {
      // DRW-R10: duplicate → all orphaned, no silent winner
      for (const el of els) {
        orphanedManaged.push(cloneWithOrphan(el, "duplicate-managed-identity"));
      }
    } else {
      activeManaged.push(els[0]!);
    }
  }

  return { activeManaged, orphanedManaged, unmanaged };
}

function isValidManagedIdentity(accordo: unknown): accordo is ManagedIdentity {
  if (typeof accordo !== "object" || accordo === null) return false;
  const a = accordo as Record<string, unknown>;
  return (
    a["version"] === 1 &&
    typeof a["identity"] === "string" && !!a["identity"] &&
    typeof a["entityKind"] === "string" &&
    typeof a["sceneRole"] === "string" &&
    typeof a["sourcePath"] === "string" &&
    typeof a["status"] === "string"
  );
}

function cloneWithOrphan(el: SceneElement, reason: string): SceneElement {
  const orig = el.customData?.accordo as ManagedIdentity | undefined;
  const orphaned: SceneElement = {
    ...el,
    customData: {
      ...(el.customData ?? {}),
      accordo: {
        version: 1,
        entityKind: orig?.entityKind ?? "node",
        identity: orig?.identity ?? el.id,
        sceneRole: orig?.sceneRole ?? "primary",
        sourcePath: orig?.sourcePath ?? "unknown",
        status: "orphaned",
        orphanReason: reason,
      } satisfies ManagedIdentity,
    },
  };
  return orphaned;
}