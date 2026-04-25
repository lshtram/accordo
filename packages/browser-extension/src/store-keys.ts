export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname;
}

export function getStorageKey(normalizedUrl: string): string {
  return `comments:${normalizedUrl}`;
}
