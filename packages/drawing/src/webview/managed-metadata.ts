import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { parseMermaidSource } from "../core/seams/source-graph.js";

export function annotateManagedElements(
  elements: readonly ExcalidrawElement[],
  sourceContent: string | undefined,
  sourcePath: string,
): readonly ExcalidrawElement[] {
  if (!sourceContent) return elements;
  let graph: ReturnType<typeof parseMermaidSource>;
  try {
    graph = parseMermaidSource(sourceContent);
  } catch {
    return elements;
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeByElementId = new Map<string, string>();
  for (const edge of graph.edges) {
    const baseId = `${edge.from}_${edge.to}`;
    const key = edgeByElementId.has(baseId) ? `${baseId}_${edge.ordinal}` : baseId;
    edgeByElementId.set(key, edge.id);
  }

  return elements.map((element) => {
    if (element.type === "text") return element;
    const existing = (element.customData as { accordo?: unknown } | undefined)?.accordo;
    if (existing) return element;

    const entity = nodeIds.has(element.id)
      ? { entityKind: "node" as const, identity: element.id }
      : edgeByElementId.has(element.id)
        ? { entityKind: "edge" as const, identity: edgeByElementId.get(element.id)! }
        : null;
    if (!entity) return element;

    return {
      ...element,
      customData: {
        ...(element.customData ?? {}),
        accordo: {
          version: 1,
          entityKind: entity.entityKind,
          identity: entity.identity,
          sceneRole: "primary",
          sourcePath,
          status: "active",
        },
      },
    };
  });
}
