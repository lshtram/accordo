/**
 * DRW-R01..R05 — Core type contracts for accordo-drawing.
 *
 * These types define the authoritative data model:
 *   - DrawingPair: the two-file source of truth (.mmd + .excalidraw)
 *   - ManagedIdentity: the stable identity carried in customData.accordo
 *   - SourceOfTruth: which file owns which concerns
 *   - SceneIndex: classified scene element buckets
 *   - MergePlan: the output of the merge planning step
 *
 * Source: docs/10-architecture/drawing-architecture.md §3, §4
 * Requirements: DRW-R01, DRW-R02, DRW-R03, DRW-R04, DRW-R05
 */

// ── Managed identity ───────────────────────────────────────────────────────────

/** DRW-R05 — Stable identity anchor. identity is Mermaid node ID or edge key. */
export interface ManagedIdentity {
  version: 1;
  entityKind: "node" | "edge" | "cluster" | "helper";
  identity: string;        // Mermaid node ID or edge key "{from}->{to}:{ordinal}"
  sceneRole: "primary" | "label" | "container" | "helper";
  sourcePath: string;      // workspace-relative .mmd path
  status: "active" | "orphaned";
  orphanReason?: string;   // present when status === "orphaned"
}

/** DRW-R02 — The .mmd file owns canonical topology/labels/diagram structure. */
export interface SourceGraph {
  type: "flowchart" | "unsupported" | "invalid";
  direction: "TD" | "TB" | "BT" | "LR" | "RL";
  nodes: SourceNode[];
  edges: SourceEdge[];
  clusters: SourceCluster[];   // deferred in slice 1
}

export interface SourceNode {
  id: string;
  label: string;
  shape?: string;
}

export interface SourceEdge {
  id: string;               // "{from}->{to}:{ordinal}"
  from: string;
  to: string;
  ordinal: number;
  label?: string;
}

export interface SourceCluster {
  id: string;
  label: string;
  memberIds: string[];
}

// ── Scene index ────────────────────────────────────────────────────────────────

/** DRW-R03 — The .excalidraw file owns positions, sizes, unmanaged elements. */
export interface SceneIndex {
  activeManaged: SceneElement[];   // customData.accordo.status === "active"
  orphanedManaged: SceneElement[]; // customData.accordo.status === "orphaned"
  unmanaged: SceneElement[];       // no customData.accordo
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

// ── Merge plan ────────────────────────────────────────────────────────────────

/** DRW-R06..R16 — The merge plan output. */
export interface MergePlan {
  preserved: SceneElement[];
  updated: SceneElement[];    // matched managed elements with new Mermaid semantics
  added: SceneElement[];       // newly placed managed elements
  removed: SceneElement[];      // managed identities deleted from source
  orphaned: SceneElement[];     // malformed/duplicate managed elements retained
  unmanaged: SceneElement[];    // preserved unmanaged elements (unchanged)
  placementEngine: "accordo" | "bootstrap";
  counts: {
    preserved: number;
    added: number;
    updated: number;
    removed: number;
    orphaned: number;
  };
}

// ── Merge report (returned by tool handlers) ─────────────────────────────────

export interface MergeReport {
  merged: true;
  path: string;
  scenePath: string;
  placementEngine: "accordo" | "bootstrap";
  counts: {
    preserved: number;
    added: number;
    updated: number;
    removed: number;
    orphaned: number;
  };
}

export interface CreateReport {
  created: true;
  path: string;
  scenePath: string;
  bootstrapEngine: "mermaid-to-excalidraw" | "empty";
  opened: boolean;
}

export interface QueryReport {
  path: string;
  scenePath: string;
  sourceType: "flowchart" | "unsupported" | "invalid";
  status: "in-sync" | "needs-merge" | "source-invalid" | "scene-invalid";
  counts: {
    managed: number;
    unmanaged: number;
    orphaned: number;
  };
  orphans?: Array<{
    elementId: string;
    orphanReason: string;
  }>;
}

export interface PatchReport extends MergeReport {
  patched: true;
}

export interface RenderReport {
  rendered: true;
  path: string;
  format: "png" | "svg";
  outputPath: string;
}

// ── File model ────────────────────────────────────────────────────────────────

/** DRW-R01 — Two-file source of truth. */
export interface DrawingPair {
  mmdPath: string;
  excalidrawPath: string;
}

/** DRW-R04 — layout.json is NOT part of this package's model. */
export type SourceOfTruth = "mmd" | "excalidraw";

// ── Error codes ──────────────────────────────────────────────────────────────

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

export class DrawingError extends Error {
  constructor(
    public readonly code: DrawingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DrawingError";
  }
}

// ── Placement constants ──────────────────────────────────────────────────────

/** DRW-R12 — Deterministic placement constants. */
export const PLACEMENT_GRID_PX = 40;
export const PLACEMENT_MAIN_GAP_PX = 160;
export const PLACEMENT_CROSS_GAP_PX = 120;
export const PLACEMENT_COMPONENT_GAP_PX = 240;
export const PLACEMENT_COLLISION_MARGIN_PX = 24;
export const PLACEMENT_SEARCH_MAX_STEPS = 24;

// ── Tool handler context ───────────────────────────────────────────────────────

/** Minimal panel-like object needed by tool handlers. */
export interface DrawingPanelLike {
  mmdPath: string;
  requestExport: (format: "png" | "svg") => Promise<Buffer>;
}

/** DRW-R22 — Shared runtime context for all drawing tools. */
export interface DrawingToolContext {
  workspaceRoot: string;
  getPanel: (path: string) => DrawingPanelLike | undefined;
}

// ── Core implementations ───────────────────────────────────────────────────────

/** DRW-R02 — Parse .mmd into a SourceGraph. */
export function parseMermaidSource(content: string): SourceGraph {
  const lines = content.trim().split("\n");
  if (lines.length === 0) {
    throw new DrawingError("source-parse-failed", "Empty source content");
  }

  // Parse directive / opening line
  const directiveMatch = lines[0].match(/^(flowchart|graph|stateDiagram-v2|classDiagram|erDiagram|pie|requirementDiagram|gantt|gitGraph|journey)\s*([TBLR][D]?)?/);
  if (!directiveMatch) {
    // Try to detect diagram type another way
    throw new DrawingError("source-parse-failed", "Unrecognized diagram directive");
  }

  const diagramType = directiveMatch[1];
  let rawDir = (directiveMatch[2] ?? "TD") as string;

  // Normalize direction: TD and TB both mean top-down → "TB"
  const direction = normalizeDirection(rawDir);

  if (diagramType !== "flowchart" && diagramType !== "graph") {
    return { type: "unsupported", direction, nodes: [], edges: [], clusters: [] };
  }

  // Parse nodes and edges from remaining lines
  const nodes = new Map<string, string>();
  const edges: SourceEdge[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("%%")) continue;

    // Node declaration: "A" or "A[Label]" or "A([Label])" etc.
    const nodeMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\s*"?([^"\]]*)"?\s*\]|\(\s*"?([^"\)]*)"?\s*\)|\{[^}]*\})?/);
    if (nodeMatch) {
      const id = nodeMatch[1];
      const label = nodeMatch[2] ?? nodeMatch[3] ?? id;
      if (!nodes.has(id)) nodes.set(id, label);
    }

    // Edge: "A-->B" or "A-->B[label]" or "A --> B"
    const edgeMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:-->|---|-\.->|==>|<-->|<-->)\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[(?:\(?[^)\]]*\)?)\])?/);
    if (edgeMatch) {
      const from = edgeMatch[1];
      const to = edgeMatch[2];
      const edgeId = `${from}->${to}:${edges.filter(e => e.from === from && e.to === to).length}`;
      edges.push({ id: edgeId, from, to, ordinal: edges.filter(e => e.from === from && e.to === to).length });
      if (!nodes.has(from)) nodes.set(from, from);
      if (!nodes.has(to)) nodes.set(to, to);
    }
  }

  if (nodes.size === 0 && edges.size === 0) {
    throw new DrawingError("source-parse-failed", "No nodes or edges found in source");
  }

  return {
    type: "flowchart",
    direction,
    nodes: Array.from(nodes.entries()).map(([id, label]) => ({ id, label })),
    edges,
    clusters: [],
  };
}

function normalizeDirection(raw: string): "TD" | "TB" | "BT" | "LR" | "RL" {
  switch (raw) {
    case "TD":
    case "TB":
      return "TB";
    case "BT":
      return "BT";
    case "LR":
      return "LR";
    case "RL":
      return "RL";
    default:
      return "TB";
  }
}

/** DRW-R03 — Index a parsed .excalidraw JSON into a SceneIndex. */
export function buildSceneIndex(sceneJson: unknown): SceneIndex {
  const elements = (sceneJson as { elements?: unknown[] })?.elements ?? [];
  if (!Array.isArray(elements)) {
    throw new DrawingError("scene-parse-failed", "scene JSON has no elements array");
  }

  const activeManaged: SceneElement[] = [];
  const orphanedManaged: SceneElement[] = [];
  const unmanaged: SceneElement[] = [];

  // Track seen (entityKind, identity, sceneRole) tuples for duplicate detection
  const identityTuples = new Map<string, SceneElement[]>();

  for (const el of elements) {
    const element = el as SceneElement;
    if (!element || typeof element !== "object") continue;

    const accordo = element.customData?.accordo;
    if (!accordo) {
      unmanaged.push(element);
      continue;
    }

    // Check well-formedness
    if (
      accordo.version !== 1 ||
      !accordo.identity ||
      !accordo.entityKind ||
      !accordo.sceneRole ||
      !accordo.sourcePath ||
      !accordo.status
    ) {
      const orphaned = { ...element };
      orphaned.customData = { ...element.customData, accordo: { ...accordo, status: "orphaned" as const, orphanReason: "malformed-identity-missing" } };
      orphanedManaged.push(orphaned);
      continue;
    }

    // Check for duplicate identity tuple
    const tupleKey = `${accordo.entityKind}::${accordo.identity}::${accordo.sceneRole}`;
    if (!identityTuples.has(tupleKey)) identityTuples.set(tupleKey, []);
    identityTuples.get(tupleKey)!.push(element);
  }

  // Second pass: distribute
  for (const [tupleKey, elementsWithKey] of identityTuples) {
    if (elementsWithKey.length > 1) {
      // Duplicate — all orphaned
      for (const el of elementsWithKey) {
        const orphaned = { ...el, customData: { ...el.customData, accordo: { ...el.customData.accordo, status: "orphaned" as const, orphanReason: "duplicate-managed-identity" } } };
        orphanedManaged.push(orphaned);
      }
    } else {
      // Single — active
      activeManaged.push(elementsWithKey[0]);
    }
  }

  // Orphaned from malformed metadata were already added above
  // Unmanaged elements (no accordo) added in first pass

  return { activeManaged, orphanedManaged, unmanaged };
}

/** DRW-R06..R16 — Compute the merge plan. */
export function computeMergePlan(source: SourceGraph, scene: SceneIndex): MergePlan {
  const sourceIdentities = new Set(source.nodes.map(n => n.id));

  // Build map of scene elements by identity
  const sceneByIdentity = new Map<string, SceneElement[]>();
  for (const el of scene.activeManaged) {
    const id = el.customData?.accordo?.identity ?? "";
    if (!sceneByIdentity.has(id)) sceneByIdentity.set(id, []);
    sceneByIdentity.get(id)!.push(el);
  }

  const preserved: SceneElement[] = [];
  const updated: SceneElement[] = [];
  const removed: SceneElement[] = [];
  const added: SceneElement[] = [];   // placeholder — will be filled by placeNewNodes

  // Process scene elements
  for (const el of scene.activeManaged) {
    const identity = el.customData?.accordo?.identity ?? "";
    if (!sourceIdentities.has(identity)) {
      // Deleted from source
      removed.push(el);
    } else {
      // Check if Mermaid label changed
      const srcNode = source.nodes.find(n => n.id === identity);
      const staleLabel = el.customData?.accordo?._staleLabel;
      if (staleLabel && srcNode && staleLabel !== srcNode.label) {
        updated.push(el);
      } else {
        preserved.push(el);
      }
    }
  }

  // Added: identities in source not in scene
  for (const nodeId of sourceIdentities) {
    if (!sceneByIdentity.has(nodeId)) {
      // Placeholder element for new node — will be positioned by placeNewNodes
      added.push({
        id: `new-${nodeId}-${Date.now()}`,
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        customData: {
          accordo: {
            version: 1 as const,
            entityKind: "node" as const,
            identity: nodeId,
            sceneRole: "primary" as const,
            sourcePath: "drawing.mmd",
            status: "active" as const,
          },
        },
      });
    }
  }

  // Determine placement engine
  const hasExistingScene = scene.activeManaged.length > 0;
  const placementEngine: "accordo" | "bootstrap" = hasExistingScene ? "accordo" : "bootstrap";

  return {
    preserved,
    updated,
    added,
    removed,
    orphaned: scene.orphanedManaged,
    unmanaged: scene.unmanaged,
    placementEngine,
    counts: {
      preserved: preserved.length,
      added: added.length,
      updated: updated.length,
      removed: removed.length,
      orphaned: scene.orphanedManaged.length,
    },
  };
}

/** DRW-R11..R16 — Place newly added managed elements using deterministic algorithm. */
export function placeNewNodes(plan: MergePlan, source: SourceGraph): MergePlan {
  if (plan.added.length === 0) return plan;

  // If no existing managed elements, use bootstrap (no placement)
  if (plan.placementEngine === "bootstrap") return plan;

  // Group added nodes by connected component
  const addedIdentities = new Set(plan.added.map(e => e.customData?.accordo?.identity).filter(Boolean));

  // Build adjacency from source edges
  const adjacency = new Map<string, Set<string>>();
  for (const edge of source.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    adjacency.get(edge.from)!.add(edge.to);
    adjacency.get(edge.to)!.add(edge.from);
  }

  // Find connected components among added nodes using preserved nodes as anchors
  const componentAnchors: Map<string, SceneElement | null> = new Map();
  for (const addedEl of plan.added) {
    const identity = addedEl.customData?.accordo?.identity ?? "";
    // Find nearest preserved neighbor by graph distance
    const anchor = findNearestPreserved(identity, plan.preserved, source, adjacency);
    componentAnchors.set(identity, anchor);
  }

  // Place each added node
  const placed = plan.added.map(el => {
    const identity = el.customData?.accordo?.identity ?? "";
    const anchor = componentAnchors.get(identity) ?? null;

    let x = PLACEMENT_MAIN_GAP_PX;
    let y = PLACEMENT_MAIN_GAP_PX;

    if (anchor) {
      // Anchor to neighbor element
      x = anchor.x + PLACEMENT_MAIN_GAP_PX;
      y = anchor.y;
    } else {
      // Frontier placement — below all existing elements
      const maxY = [...plan.preserved, ...plan.unmanaged].reduce((m, e) => Math.max(m, e.y + (e.height ?? 40)), 0);
      y = maxY + PLACEMENT_COMPONENT_GAP_PX;
    }

    // Collision resolution: search for non-overlapping slot
    const allOccupied = [...plan.preserved, ...plan.unmanaged, ...plan.added.filter(e => e !== el)];
    const collisionResult = resolveCollision(x, y, el.width ?? 100, el.height ?? 40, allOccupied);
    x = collisionResult.x;
    y = collisionResult.y;

    return { ...el, x, y };
  });

  return {
    ...plan,
    added: placed,
    counts: { ...plan.counts, added: placed.length },
  };
}

function findNearestPreserved(
  nodeId: string,
  preserved: SceneElement[],
  source: SourceGraph,
  adjacency: Map<string, Set<string>>
): SceneElement | null {
  if (preserved.length === 0) return null;

  // BFS to find nearest preserved node through source graph
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
  let best: SceneElement | null = null;
  let bestDist = Infinity;

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (depth > 3) continue; // max search depth

    const p = preserved.find(el => el.customData?.accordo?.identity === id);
    if (p) {
      const dist = Math.abs(p.x) + Math.abs(p.y);
      if (depth < bestDist) {
        bestDist = depth;
        best = p;
      }
    }

    const neighbors = adjacency.get(id);
    if (neighbors) {
      for (const n of neighbors) {
        if (!visited.has(n)) queue.push({ id: n, depth: depth + 1 });
      }
    }
  }

  return best;
}

function resolveCollision(
  x: number,
  y: number,
  w: number,
  h: number,
  occupied: SceneElement[]
): { x: number; y: number } {
  for (let step = 0; step < PLACEMENT_SEARCH_MAX_STEPS; step++) {
    const candidate = getSlot(x, y, step, w, h);
    const collides = occupied.some(el =>
      rectanglesOverlap(
        candidate.x - PLACEMENT_COLLISION_MARGIN_PX,
        candidate.y - PLACEMENT_COLLISION_MARGIN_PX,
        w + 2 * PLACEMENT_COLLISION_MARGIN_PX,
        h + 2 * PLACEMENT_COLLISION_MARGIN_PX,
        el.x,
        el.y,
        el.width ?? 100,
        el.height ?? 40
      )
    );
    if (!collides) return candidate;
  }
  // Fallback: return last candidate (may overlap but keeps determinism)
  return getSlot(x, y, PLACEMENT_SEARCH_MAX_STEPS - 1, w, h);
}

function getSlot(baseX: number, baseY: number, step: number, w: number, h: number): { x: number; y: number } {
  const sign = step % 2 === 0 ? 1 : -1;
  const offset = Math.ceil((step + 1) / 2) * PLACEMENT_GRID_PX;
  // Search horizontally first (main gap direction)
  return { x: baseX + sign * offset, y: baseY };
}

function rectanglesOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}