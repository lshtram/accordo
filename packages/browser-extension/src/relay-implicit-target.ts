export async function resolveImplicitTargetTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

export async function resolveImplicitTargetTabId(): Promise<number | undefined> {
  const tab = await resolveImplicitTargetTab();
  return tab?.id;
}
