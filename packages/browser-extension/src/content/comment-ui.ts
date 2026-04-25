/**
 * Comment UI facade — SDK init, pin rendering, floating bar, and Comments Mode.
 */

export {
  assertMessageSuccess,
  coordinateToScreen,
  dbg,
  dbgErr,
  destroySdk,
  getPendingAnchorContexts,
  getSdk,
  loadAndRenderPins,
  toSdkThread,
  wireSdkCallbacks,
} from "./comment-ui-runtime.js";
export {
  activateCommentsMode,
  deactivateCommentsMode,
  generateAnchorKeyFromClick,
  getAnchorContext,
  hideFloatingBar,
  isCommentsModeActive,
  showFloatingBar,
} from "./comment-ui-mode.js";
