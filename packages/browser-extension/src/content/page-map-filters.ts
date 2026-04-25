/**
 * M102-FILT — Page Map Server-Side Filters facade
 *
 * @module
 */

import type { FilterSummary } from "./page-map-types.js";
import type { FilterPipeline, PageMapOptions } from "./page-map-filter-types.js";
import type { ElementFilter } from "./page-map-filter-types.js";
import {
  hasUsableRegion,
  intersectsRegion,
  INTERACTIVE_EVENT_ATTRS,
  INTERACTIVE_ROLES,
  INTERACTIVE_TAGS,
  IMPLICIT_ROLE_MAP,
  isInteractive,
  isInViewport,
  matchesRoles,
  matchesSelector,
  matchesText,
} from "./page-map-filter-predicates.js";

export type { ElementFilter, FilterPipeline, PageMapOptions } from "./page-map-filter-types.js";
export {
  hasUsableRegion,
  intersectsRegion,
  INTERACTIVE_EVENT_ATTRS,
  INTERACTIVE_ROLES,
  INTERACTIVE_TAGS,
  IMPLICIT_ROLE_MAP,
  isInteractive,
  isInViewport,
  matchesRoles,
  matchesSelector,
  matchesText,
} from "./page-map-filter-predicates.js";

export function buildFilterPipeline(options: PageMapOptions): FilterPipeline {
  const filters: ElementFilter[] = [];
  const activeFilterNames: string[] = [];

  if (options.visibleOnly) {
    filters.push(isInViewport);
    activeFilterNames.push("visibleOnly");
  }
  if (options.interactiveOnly) {
    filters.push(isInteractive);
    activeFilterNames.push("interactiveOnly");
  }
  if (options.roles && options.roles.length > 0) {
    filters.push(matchesRoles(options.roles));
    activeFilterNames.push("roles");
  }
  if (options.textMatch) {
    filters.push(matchesText(options.textMatch));
    activeFilterNames.push("textMatch");
  }
  if (options.selector) {
    filters.push(matchesSelector(options.selector));
    activeFilterNames.push("selector");
  }
  if (hasUsableRegion(options.regionFilter)) {
    filters.push(intersectsRegion(options.regionFilter));
    activeFilterNames.push("regionFilter");
  }

  return { filters, activeFilterNames, hasFilters: filters.length > 0 };
}

export function applyFilters(pipeline: FilterPipeline, element: Element): boolean {
  for (const filter of pipeline.filters) {
    if (!filter(element)) return false;
  }
  return true;
}

export function buildFilterSummary(
  pipeline: FilterPipeline,
  totalBeforeFilter: number,
  totalAfterFilter: number,
): FilterSummary | undefined {
  if (!pipeline.hasFilters) return undefined;
  const reductionRatio = totalBeforeFilter === 0 ? 0 : (totalBeforeFilter - totalAfterFilter) / totalBeforeFilter;
  return {
    activeFilters: [...pipeline.activeFilterNames],
    totalBeforeFilter,
    totalAfterFilter,
    reductionRatio,
  };
}
