let refIndex: Map<string, Element> = new Map();
let elementToNodeId: Map<Element, number> = new Map();
let nextSyntheticNodeId = -1;
let nodeIdToUid: Map<number, string> = new Map();

export function ensureSyntheticNodeId(element: Element): number {
  const existing = elementToNodeId.get(element);
  if (existing !== undefined) return existing;
  const nodeId = nextSyntheticNodeId--;
  elementToNodeId.set(element, nodeId);
  return nodeId;
}

export function getElementByRef(ref: string): Element | null {
  return refIndex.get(ref) ?? null;
}

export function getNodeIdByElement(element: Element): number | undefined {
  return elementToNodeId.get(element);
}

export function getUidByNodeId(nodeId: number): string | undefined {
  return nodeIdToUid.get(nodeId);
}

export function clearRefIndex(): void {
  refIndex = new Map();
  elementToNodeId = new Map();
  nodeIdToUid = new Map();
  nextSyntheticNodeId = -1;
}

export function registerNode(ref: string, element: Element, nodeId: number, uid: string): void {
  refIndex.set(ref, element);
  elementToNodeId.set(element, nodeId);
  nodeIdToUid.set(nodeId, uid);
}
