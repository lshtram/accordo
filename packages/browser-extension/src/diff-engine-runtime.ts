import type { DiffChange, DiffNode, DiffResult, DiffSummary, FlatNode, NodeIdentity, VersionedSnapshot } from "./diff-engine-types.js";

export function flattenNodes(nodes: readonly NodeIdentity[]): FlatNode[] {
  const result: FlatNode[] = [];

  function visit(node: NodeIdentity): void {
    result.push({
      nodeId: node.nodeId,
      // Stable structural identity — never text-coupled (which would suppress
      // real text changes and make text mutations produce spurious persistentIds).
      persistentId: node.persistentId ?? `${node.tag}:${node.id ?? ""}:nodeId:${node.nodeId}`,
      tag: node.tag,
      text: node.text,
      role: node.role,
      id: node.id,
    });
    for (const child of node.children ?? []) visit(child);
  }

  for (const node of nodes) visit(node);
  return result;
}

export function buildNodeIndex(flatNodes: readonly FlatNode[]): Map<string, FlatNode> {
  const index = new Map<string, FlatNode>();
  for (const node of flatNodes) {
    if (!index.has(node.persistentId)) {
      index.set(node.persistentId, node);
    }
  }
  return index;
}

export function formatTextDelta(added: number, removed: number, changed: number): string {
  if (added === 0 && removed === 0 && changed === 0) return "no changes";
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  if (changed > 0) parts.push(`${changed} changed`);
  return parts.join(", ");
}

export function computeDiff(from: VersionedSnapshot, to: VersionedSnapshot): DiffResult {
  const fromFlat = flattenNodes(from.nodes);
  const toFlat = flattenNodes(to.nodes);
  const fromIndex = buildNodeIndex(fromFlat);
  const toIndex = buildNodeIndex(toFlat);
  const fromIsPartial = isPartialSnapshot(from);
  const toIsPartial = isPartialSnapshot(to);

  const added: DiffNode[] = [];
  if (!fromIsPartial) {
    for (const [pid, node] of toIndex) {
      if (!fromIndex.has(pid)) {
        added.push({ nodeId: node.nodeId, tag: node.tag, id: node.id, text: node.text, role: node.role });
      }
    }
  }

  const removed: DiffNode[] = [];
  if (!toIsPartial) {
    for (const [pid, node] of fromIndex) {
      if (!toIndex.has(pid)) {
        removed.push({ nodeId: node.nodeId, tag: node.tag, id: node.id, text: node.text, role: node.role });
      }
    }
  }

  const changed: DiffChange[] = [];
  for (const [pid, fromNode] of fromIndex) {
    const toNode = toIndex.get(pid);
    if (toNode === undefined) continue;

    if ((fromNode.text ?? "") !== (toNode.text ?? "")) {
      changed.push({ nodeId: toNode.nodeId, tag: toNode.tag, field: "textContent", before: fromNode.text ?? "", after: toNode.text ?? "" });
    }

    if (fromNode.role !== undefined && toNode.role !== undefined && fromNode.role !== toNode.role) {
      changed.push({ nodeId: toNode.nodeId, tag: toNode.tag, field: "role", before: fromNode.role, after: toNode.role });
    } else if (fromNode.role !== toNode.role) {
      if (fromNode.role !== undefined || toNode.role !== undefined) {
        changed.push({ nodeId: toNode.nodeId, tag: toNode.tag, field: "role", before: fromNode.role ?? "", after: toNode.role ?? "" });
      }
    }
  }

  const summary: DiffSummary = {
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
    textDelta: formatTextDelta(added.length, removed.length, changed.length),
  };

  return {
    pageId: to.pageId,
    frameId: to.frameId,
    snapshotId: to.snapshotId,
    capturedAt: to.capturedAt,
    viewport: to.viewport,
    source: to.source,
    fromSnapshotId: from.snapshotId,
    toSnapshotId: to.snapshotId,
    added,
    removed,
    changed,
    summary,
  };
}

function isPartialSnapshot(snapshot: VersionedSnapshot): boolean {
  const metadata = snapshot as VersionedSnapshot & { truncated?: unknown; hasMore?: unknown };
  return metadata.truncated === true || metadata.hasMore === true;
}
