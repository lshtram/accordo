export function openSdkComposerAtAnchor(target: Element, anchorKey: string, clientX: number, clientY: number): void {
  target.setAttribute("data-anchor", anchorKey);
  target.setAttribute("data-block-id", anchorKey);

  const view = target.ownerDocument.defaultView;
  if (!view) return;

  const evt = new view.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    altKey: true,
  });
  target.dispatchEvent(evt);
}
