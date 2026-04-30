export function hasQueryTarget(args: {
  uid?: string;
  anchorKey?: string;
  ref?: string;
  selector?: string;
  nodeId?: number;
}): boolean {
  return isNonEmpty(args.uid) || isNonEmpty(args.anchorKey) || isNonEmpty(args.ref) || isNonEmpty(args.selector) || typeof args.nodeId === "number";
}

export function hasDomExcerptTarget(args: { anchorKey?: string; selector?: string }): boolean {
  return isNonEmpty(args.anchorKey) || isNonEmpty(args.selector);
}

export function isMalformedUid(uid?: string): boolean {
  if (!hasNonEmpty(uid)) return false;
  return !hasValidFrameScopedNodeId(uid);
}

export function isMalformedFrameScopedUid(uid?: string): boolean {
  if (!hasNonEmpty(uid)) return false;
  if (!uid.includes(":")) return false;
  return !hasValidFrameScopedNodeId(uid);
}

export function isMalformedSelector(selector?: string): boolean {
  if (!hasNonEmpty(selector)) return false;
  const dom = getDocument();
  if (!dom) return false;
  try {
    dom.querySelector(selector);
    return false;
  } catch {
    return true;
  }
}

export function inspectTargetKind(args: {
  uid?: string;
  anchorKey?: string;
  ref?: string;
  selector?: string;
  nodeId?: number;
}): "uid" | "anchorKey" | "ref" | "selector" | "nodeId" | undefined {
  if (isNonEmpty(args.uid)) return "uid";
  if (isNonEmpty(args.anchorKey)) return "anchorKey";
  if (isNonEmpty(args.ref)) return "ref";
  if (isNonEmpty(args.selector)) return "selector";
  if (typeof args.nodeId === "number") return "nodeId";
  return undefined;
}

export function domExcerptTargetKind(args: { anchorKey?: string; selector?: string }): "anchorKey" | "selector" | undefined {
  if (isNonEmpty(args.anchorKey)) return "anchorKey";
  if (isNonEmpty(args.selector)) return "selector";
  return undefined;
}

function isNonEmpty(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmpty(value?: string): value is string {
  return isNonEmpty(value);
}

function hasValidFrameScopedNodeId(uid: string): boolean {
  if (uid.includes(" ")) return false;
  const colonIdx = uid.lastIndexOf(":");
  if (colonIdx <= 0 || colonIdx === uid.length - 1) return false;
  const nodeIdStr = uid.slice(colonIdx + 1);
  if (!/^\d+$/.test(nodeIdStr)) return false;
  const nodeId = Number.parseInt(nodeIdStr, 10);
  return Number.isInteger(nodeId) && nodeId >= 0 && String(nodeId) === nodeIdStr;
}

function getDocument(): { querySelector(selector: string): unknown | null } | undefined {
  const candidate = (globalThis as { document?: { querySelector(selector: string): unknown | null } }).document;
  return typeof candidate?.querySelector === "function" ? candidate : undefined;
}
