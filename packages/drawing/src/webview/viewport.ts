export interface ExcalidrawViewportState {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export function viewportFromAppState(appState: Record<string, unknown>): ExcalidrawViewportState {
  const zoomValue = appState.zoom;
  const zoom = typeof zoomValue === "number"
    ? zoomValue
    : typeof zoomValue === "object" && zoomValue !== null && typeof (zoomValue as { value?: unknown }).value === "number"
      ? (zoomValue as { value: number }).value
      : 1;
  return {
    scrollX: Number(appState.scrollX ?? 0),
    scrollY: Number(appState.scrollY ?? 0),
    zoom: Number(zoom),
  };
}

export function sameViewport(a: ExcalidrawViewportState, b: ExcalidrawViewportState): boolean {
  return a.scrollX === b.scrollX && a.scrollY === b.scrollY && a.zoom === b.zoom;
}
