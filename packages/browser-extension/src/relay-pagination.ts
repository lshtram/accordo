export function clampOffsetLimit(
  payload: Record<string, unknown>,
  defaultCap: number,
  maxCap: number,
  userCapField?: "maxNodes" | "maxSegments",
): { offset: number; limit: number; hasPagination: boolean } {
  const hasPagination = payload.offset !== undefined || payload.limit !== undefined;
  const userCapRaw = userCapField ? payload[userCapField] : undefined;
  const userCap = typeof userCapRaw === "number" ? userCapRaw : defaultCap;
  const effectiveCap = Math.min(userCap, maxCap);
  const offset = Math.max(0, typeof payload.offset === "number" ? payload.offset : 0);
  const limit = typeof payload.limit === "number"
    ? Math.min(Math.max(1, payload.limit), effectiveCap)
    : effectiveCap;
  return { offset, limit, hasPagination };
}

export function appendPaginationMetadata(
  data: Record<string, unknown>,
  opts: {
    itemsKey: "nodes" | "segments";
    totalAvailable: number;
    offset: number;
    limit: number;
  },
): void {
  const rawItems = data[opts.itemsKey];
  const items = Array.isArray(rawItems) ? rawItems : [];
  const sliced = items.slice(opts.offset, opts.offset + opts.limit);
  data[opts.itemsKey] = sliced;

  const nextOffset = opts.offset + sliced.length;
  data.hasMore = nextOffset < opts.totalAvailable;
  data.totalAvailable = opts.totalAvailable;
  if (sliced.length > 0) {
    data.nextOffset = nextOffset;
  }
}
