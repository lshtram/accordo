/**
 * M80-CS-INPUT — Content Script: Comment Input & Popovers facade
 */

export {
  generateAnchorKey,
  getAnchorKeyFromEvent,
  hideCommentForm,
  injectContextMenu,
  removeContextMenu,
  showCommentForm,
} from "./content-input-form.js";
export { hideThreadPopover, showThreadPopover } from "./content-input-popover.js";
