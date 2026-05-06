/**
 * Thin re-export layer — redirects ./types.js → ../types.js for seam files.
 * This prevents TypeScript's module resolution from failing when seam files
 * reference a types file that has been consolidated into ../types.ts.
 *
 * DRW-R01..R05, DRW-R22 — Core type contracts for accordo-drawing.
 */
export * from "../types.js";