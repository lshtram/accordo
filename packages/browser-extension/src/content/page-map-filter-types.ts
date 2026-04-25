import type { PageMapOptions } from "./page-map-types.js";

export type ElementFilter = (element: Element) => boolean;

export interface FilterPipeline {
  readonly filters: readonly ElementFilter[];
  readonly activeFilterNames: readonly string[];
  readonly hasFilters: boolean;
}

export type { PageMapOptions };
