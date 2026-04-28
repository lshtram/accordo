/**
 * Spatial Relations — Grammar parsing utilities (content-script)
 *
 * Re-exports the canonical parser from the shared location.
 * All parsing logic lives in ../spatial-grammar.ts (relay + content shared).
 *
 * @module
 */

// Re-export everything from the canonical shared source
export { parseSnapshotId, parseUid } from "../spatial-grammar.js";
