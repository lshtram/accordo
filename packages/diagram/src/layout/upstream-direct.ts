/**
 * upstream-direct — bypass the dagre pipeline and render upstream output.
 *
 * Uses `@excalidraw/mermaid-to-excalidraw` to parse Mermaid directly into
 * Excalidraw element skeletons.
 */

type ExcalidrawElementSkeleton = Record<string, unknown>;

async function applyNodeShim(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.window !== "undefined") return;

  const { Window } = await import("happy-dom");
  const win = new Window();
  g.window = win as unknown as Window & typeof globalThis;
  g.document = win.document as unknown as Document;
}

/**
 * Parse Mermaid source via upstream library into Excalidraw skeletons.
 */
export async function renderUpstreamDirect(
  source: string,
): Promise<ExcalidrawElementSkeleton[]> {
  await applyNodeShim();

  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const result = await parseMermaidToExcalidraw(source);
  return result.elements as ExcalidrawElementSkeleton[];
}
