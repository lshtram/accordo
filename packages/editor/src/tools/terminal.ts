export {
  createTerminalId,
  findTerminalId,
  getTerminal,
  trackTerminal,
  adoptTerminal,
  terminalMap,
  _resetTerminalMap,
} from "./terminal/terminal-state.js";
export { registerTerminalLifecycle } from "./terminal/terminal-lifecycle.js";
export { terminalOpenHandler } from "./terminal/terminal-open.js";
export { terminalRunHandler } from "./terminal/terminal-run.js";
export { terminalFocusHandler } from "./terminal/terminal-focus.js";
export { terminalListHandler } from "./terminal/terminal-list.js";
export { terminalCloseHandler } from "./terminal/terminal-close.js";
export type { TerminalInfo } from "./terminal/terminal-list.js";
export { terminalTools } from "./terminal/terminal-tools.js";
