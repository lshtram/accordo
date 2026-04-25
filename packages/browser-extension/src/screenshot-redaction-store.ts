import type { TextMapSnapshot, TextSegment, VersionedSnapshot } from "./screenshot-redaction-types.js";

export function extractTextMapFromSnapshot(
  snapshot: VersionedSnapshot,
): TextMapSnapshot | null {
  try {
    const nodes = (snapshot as unknown as { nodes?: TextSegment[] }).nodes;
    if (!nodes || !Array.isArray(nodes)) return null;
    const first = nodes[0];
    if (!first || !("bbox" in first) || !("textRaw" in first)) return null;
    return { segments: nodes as TextSegment[], pageUrl: snapshot.pageId };
  } catch {
    return null;
  }
}

export async function findLatestTextMapSnapshot(
  store: { getLatest(pageId: string): Promise<{ snapshotId: string; pageId: string; capturedAt: string } | undefined> },
  pageId: string,
): Promise<TextMapSnapshot | null> {
  const latest = await store.getLatest(pageId);
  if (!latest) return null;
  return extractTextMapFromSnapshot(latest as unknown as VersionedSnapshot);
}
