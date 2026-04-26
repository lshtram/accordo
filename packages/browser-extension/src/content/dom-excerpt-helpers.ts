export interface SerializeResult {
  html: string;
  text: string;
}

export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeNodeText(value: string): string {
  return value.replace(/\s+/g, " ");
}

export function normalizeTarget(
  target: string | { selector?: string; anchorKey?: string; creationSnapshotId?: string },
): { selector?: string; anchorKey?: string; creationSnapshotId?: string } {
  return {
    selector: typeof target === "string" ? target : target.selector,
    anchorKey: typeof target === "string" ? undefined : target.anchorKey,
    creationSnapshotId: typeof target === "string" ? undefined : target.creationSnapshotId,
  };
}

export function boundExcerpt(excerpt: SerializeResult, maxLength: number): SerializeResult & { truncated: boolean } {
  const html = excerpt.html.slice(0, maxLength);
  const text = excerpt.text.slice(0, maxLength);
  return {
    html,
    text,
    truncated: excerpt.html.length > maxLength || excerpt.text.length > maxLength,
  };
}
