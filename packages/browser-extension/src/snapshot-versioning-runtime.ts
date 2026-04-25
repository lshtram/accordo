import type { NodeIdentity, SnapshotEnvelope, SnapshotSource, VersionedSnapshot, Viewport } from "./snapshot-versioning-types.js";

export function createPageSessionId(): string {
  return `pg_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function computePersistentId(tag: string, id: string | undefined, text: string | undefined): string {
  const raw = `${tag}:${id ?? ""}:${text ?? ""}`;
  return btoa(unescape(encodeURIComponent(raw)));
}

export function enrichNode(node: NodeIdentity): NodeIdentity {
  const persistentId = computePersistentId(node.tag, node.id, node.text);
  const children = (node.children ?? []).map(enrichNode);
  return { ...node, persistentId, children };
}

export function captureViewport(): Viewport {
  return {
    width: (typeof window !== "undefined" ? window.innerWidth : 0) || 1280,
    height: (typeof window !== "undefined" ? window.innerHeight : 0) || 800,
    scrollX: typeof window !== "undefined" ? (window.scrollX ?? 0) : 0,
    scrollY: typeof window !== "undefined" ? (window.scrollY ?? 0) : 0,
    devicePixelRatio: (typeof window !== "undefined" ? window.devicePixelRatio : 0) || 1,
  };
}

export function findNodeByTag(nodes: readonly NodeIdentity[], tag: string): NodeIdentity | undefined {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const found = findNodeByTag(node.children ?? [], tag);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function buildSnapshotEnvelope(pageId: string, snapshotId: string, source: SnapshotSource = "dom"): SnapshotEnvelope {
  return {
    pageId,
    frameId: "main",
    snapshotId,
    capturedAt: new Date().toISOString(),
    viewport: captureViewport(),
    source,
  };
}

export function buildVersionedSnapshot(
  pageId: string,
  version: number,
  source: SnapshotSource,
  nodes: NodeIdentity[],
  totalElements: number,
): VersionedSnapshot {
  const snapshotId = `${pageId}:${version}`;
  return {
    ...buildSnapshotEnvelope(pageId, snapshotId, source),
    nodes: nodes.map(enrichNode),
    totalElements,
  };
}
