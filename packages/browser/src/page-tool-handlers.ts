/**
 * M91-PU + M91-CR — Page Tool Handlers (facade)
 * @module
 */
export type { CaptureRegionArgs, CaptureRegionResponse, CaptureError, DomExcerptResponse, GetDomExcerptArgs, GetPageMapArgs, GetSemanticGraphArgs, GetSpatialRelationsArgs, GetTextMapArgs, InspectElementArgs, InspectElementResponse, ListPagesArgs, ListPagesResponse, PageMapResponse, PageToolError, SelectPageArgs, SelectPageResponse, SpatialError, SpatialRelationsResponse, WaitForArgs } from "./page-tool-types.js";
export { CAPTURE_REGION_TIMEOUT_MS, classifyRelayError, EXCERPT_TIMEOUT_MS, INSPECT_TIMEOUT_MS, PAGE_MAP_TIMEOUT_MS, SEMANTIC_GRAPH_TIMEOUT_MS, SPATIAL_RELATIONS_TIMEOUT_MS, TAB_MGMT_TIMEOUT_MS, TEXT_MAP_TIMEOUT_MS, WAIT_FOR_RELAY_TIMEOUT_MS } from "./page-tool-types.js";
export { handleCaptureRegion, handleGetDomExcerpt, handleGetPageMap, handleGetSemanticGraphInline, handleGetTextMapInline, handleInspectElement, handleListPages, handleSelectPage, handleWaitForInline } from "./page-tool-handlers-impl.js";
