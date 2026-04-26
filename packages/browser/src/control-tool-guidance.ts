export function buildPermissionGuidance<T extends { success: false; error?: string }>(response: T): T {
  if (response.error !== "control-not-granted") return response;
  return {
    ...response,
    message: "This tab has not been granted browser control yet.",
    agentAction: "Ask the user to grant browser control for this tab in the Accordo browser extension popup, then retry the action.",
    userAction: "Open the Accordo browser extension popup for the target tab and grant control access.",
  };
}

export function withControlGuidance<T extends { success: false; error?: string }>(response: T): T {
  const permission = buildPermissionGuidance(response);
  switch (permission.error) {
    case "no-target":
      return { ...permission, message: "No usable target was provided.", agentAction: "Retry with uid, selector, or coordinates as required by the tool." };
    case "element-not-found":
      return { ...permission, message: "The requested target could not be found.", agentAction: "Refresh page state and retry with a current selector or uid." };
    case "element-off-screen":
      return { ...permission, message: "The target exists but is outside the visible viewport.", agentAction: "Scroll or use a different target before retrying." };
    case "iframe-cross-origin":
      return { ...permission, message: "The target is inside a cross-origin iframe.", agentAction: "Retry from a same-origin frame or use a frame-safe target." };
    case "no-content-script":
      return { ...permission, message: "The page cannot currently service DOM-based targeting.", agentAction: "Reload the page or retry after content script injection completes." };
    default:
      return permission;
  }
}
