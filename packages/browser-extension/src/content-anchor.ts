export function normalizeAnchorFingerprint(text: string): string {
  const raw = text
    .toLowerCase()
    .slice(0, 20)
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return raw || "text";
}

export interface ParsedAnchorKey {
  tagName: string;
  siblingIndex: number;
  fingerprint: string;
  offsetX?: number;
  offsetY?: number;
}

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}

export function findAnchorElementByKey(anchorKey: string): Element | null {
  const existing = document.querySelector(`[data-anchor="${escapeSelectorValue(anchorKey)}"]`);
  if (existing) return existing;

  const parsed = parseAnchorKey(anchorKey);
  if (!parsed) return null;

  const { tagName, siblingIndex, fingerprint } = parsed;

  const candidates = Array.from(document.getElementsByTagName(tagName));
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const idx = Array.from(candidate.parentElement?.children ?? []).indexOf(candidate);
    if (idx !== siblingIndex) continue;
    if (normalizeAnchorFingerprint(candidate.textContent ?? "") === fingerprint) {
      candidate.setAttribute("data-anchor", anchorKey);
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (normalizeAnchorFingerprint(candidate.textContent ?? "") === fingerprint) {
      candidate.setAttribute("data-anchor", anchorKey);
      return candidate;
    }
  }

  return null;
}

export function parseAnchorKey(anchorKey: string): ParsedAnchorKey | null {
  const [tagName, siblingIndexRaw, fingerprintWithOffset] = anchorKey.split(":");
  if (!tagName || siblingIndexRaw === undefined || !fingerprintWithOffset) return null;

  const siblingIndex = Number(siblingIndexRaw);
  if (!Number.isInteger(siblingIndex) || siblingIndex < 0) return null;

  const [fingerprint, offsetRaw] = fingerprintWithOffset.split("@");
  if (!fingerprint) return null;

  let offsetX: number | undefined;
  let offsetY: number | undefined;
  if (offsetRaw) {
    const [xRaw, yRaw] = offsetRaw.split(",");
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      offsetX = x;
      offsetY = y;
    }
  }

  return { tagName, siblingIndex, fingerprint, offsetX, offsetY };
}

export function getAnchorPagePosition(anchorKey: string, anchorElement: Element): { x: number; y: number } {
  const rect = anchorElement.getBoundingClientRect();
  const parsed = parseAnchorKey(anchorKey);

  if (parsed && parsed.offsetX !== undefined && parsed.offsetY !== undefined) {
    const clampedX = Math.max(0, Math.min(parsed.offsetX, rect.width || parsed.offsetX));
    const clampedY = Math.max(0, Math.min(parsed.offsetY, rect.height || parsed.offsetY));
    return {
      x: rect.left + window.scrollX + clampedX - 12,
      y: rect.top + window.scrollY + clampedY + 4,
    };
  }

  return {
    x: rect.right + window.scrollX - 12,
    y: rect.top + window.scrollY + 4,
  };
}
