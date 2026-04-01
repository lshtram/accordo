/**
 * script/index.ts
 *
 * Barrel export for the Hub's script module.
 * Re-exports the public API needed by server.ts to wire up
 * the script runner and register its Hub-native tools.
 */

export { ScriptRunner } from "./script-runner.js";
export type { ScriptRunnerDeps, ScriptRunnerCallbacks } from "./script-runner.js";
export { createScriptDepsAdapter } from "./script-deps-adapter.js";
export { createScriptTools } from "./script-tools.js";
export type { ScriptToolDeps } from "./script-tools.js";
