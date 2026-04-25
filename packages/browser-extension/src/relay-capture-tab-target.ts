export interface CaptureTabContext {
  originalTabId: number | undefined;
  targetTabId: number | undefined;
  swapped: boolean;
}

export async function prepareCaptureTab(targetTabId?: number): Promise<CaptureTabContext> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const originalTabId = activeTab?.id;
  const resolvedTargetTabId = targetTabId ?? originalTabId;
  let swapped = false;
  if (resolvedTargetTabId !== undefined && originalTabId !== resolvedTargetTabId) {
    await chrome.tabs.update(resolvedTargetTabId, { active: true });
    swapped = true;
  }
  return { originalTabId, targetTabId: resolvedTargetTabId, swapped };
}

export async function restoreCaptureTab(context: CaptureTabContext): Promise<void> {
  if (context.swapped && context.originalTabId !== undefined) {
    await chrome.tabs.update(context.originalTabId, { active: true });
  }
}
