/**
 * Editor tool handlers for accordo-editor.
 *
 * Barrel re-export — combines handler functions and tool definitions
 * into a single public surface for backward compatibility.
 *
 * Remaining tools (migrated to generic gateway):
 *   Module 16: §4.1 open, §4.2 close, §4.3 scroll, §4.7 focus (group)
 *   Module 17: §4.4 highlight, §4.5 clearHighlights
 *
 * Removed exports (migrated to generic gateway via accordo_vscode_command_execute):
 *   split (§4.6), reveal (§4.8), save (§4.17), saveAll (§4.18), format (§4.19)
 */

export {
  argString,
  argStringOpt,
  argNumber,
  argNumberOpt,
  openHandler,
  closeHandler,
  scrollHandler,
  highlightHandler,
  clearHighlightsHandler,
  focusGroupHandler,
  _clearDecorationStore,
} from "./editor-handlers.js";

export { editorTools } from "./editor-definitions.js";
