/**
 * @accordo/bridge-types — Compile-time type contracts
 *
 * These type-level assertions are checked by `tsc --noEmit`.
 * If any assertion fails, the package will not compile — signaling
 * a contract violation for REQ-6 (IDEState) and REQ-7 (ToolRegistration).
 *
 * Unlike vitest runtime tests, these are validated at compile time,
 * so they cannot be bypassed by excluding the test file from tsc.
 *
 * API checklist:
 *   IDEState (REQ-6):
 *     - has `openTabs: OpenTab[]`      → covered by _REQ6_openTabs
 *   ToolRegistration (REQ-7):
 *     - has `name: string`            → covered by _REQ7_flat_name
 *     - has `description: string`     → covered by _REQ7_flat_description
 *     - has `dangerLevel: DangerLevel` → covered by _REQ7_flat_dangerLevel
 *     - does NOT have `handler`        → covered by _REQ7_no_handler
 */

import type {
  IDEState,
  OpenTab,
  ToolRegistration,
  DangerLevel,
} from "../index.js";

// ─── REQ-6: IDEState required fields ────────────────────────────────────────

/**
 * REQ-6 contract: IDEState must have `openTabs: OpenTab[]`.
 * Source: requirements-hub.md §3.3
 * We verify this by assigning the actual IDEState to a variable typed
 * with the expected shape. If `openTabs` is missing from IDEState, TypeScript
 * will error here.
 */
export const _REQ6_openTabs: {
  openTabs: OpenTab[];
} = {} as IDEState;

// ─── REQ-7: ToolRegistration is flat, data-only (no handler) ────────────────

/**
 * REQ-7 contract: ToolRegistration must have `name: string` at top level (flat).
 * If the interface wraps fields inside a `definition` sub-object, this fails.
 */
export const _REQ7_flat_name: {
  name: string;
} = {} as ToolRegistration;

/**
 * REQ-7 contract: ToolRegistration must have `description: string` at top level.
 */
export const _REQ7_flat_description: {
  description: string;
} = {} as ToolRegistration;

/**
 * REQ-7 contract: ToolRegistration must have `dangerLevel: DangerLevel` at top level.
 */
export const _REQ7_flat_dangerLevel: {
  dangerLevel: DangerLevel;
} = {} as ToolRegistration;

/**
 * REQ-7 contract: ToolRegistration must NOT have a `handler` field.
 * Handler functions are never serialized — they stay in the Bridge.
 * Rule: AGENTS.md §4.3, requirements-bridge.md §3.2
 *
 * This is validated by checking that `handler` is NOT a key of ToolRegistration.
 * If someone adds `handler` to ToolRegistration, this assertion will fail at compile time.
 */
type _AssertNoHandler = ToolRegistration extends { handler: unknown } ? never : true;
const _REQ7_no_handler: _AssertNoHandler = true;
