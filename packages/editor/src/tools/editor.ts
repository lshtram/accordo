/**
 * Editor tool handlers for accordo-editor.
 *
 * Barrel re-export — combines handler functions and tool definitions
 * into a single public surface for backward compatibility.
 *
 * Implements the following tools from requirements-editor.md §4:
 *   Module 16: §4.1 open, §4.2 close, §4.3 scroll, §4.6 split,
 *              §4.7 focus (group), §4.8 reveal
 *   Module 17: §4.4 highlight, §4.5 clearHighlights,
 *              §4.17 save, §4.18 saveAll, §4.19 format
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
  splitHandler,
  focusGroupHandler,
  revealHandler,
  saveHandler,
  saveAllHandler,
  formatHandler,
  _clearDecorationStore,
} from "./editor-handlers.js";

export { editorTools } from "./editor-definitions.js";
