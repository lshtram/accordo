/** Map a relay error code to a page tool error code. */
export function mapRelayError(errCode: string | undefined): string {
  switch (errCode) {
    case "origin-blocked": return "origin-blocked";
    case "iframe-cross-origin": return "iframe-cross-origin";
    case "no-content-script": return "no-content-script";
    case "browser-not-connected": return "browser-not-connected";
    case "timeout": return "timeout";
    case "element-not-found": return "element-not-found";
    case "element-off-screen": return "element-off-screen";
    case "invalid-request": return "invalid-request";
    case "snapshot-not-found": return "snapshot-not-found";
    case "snapshot-stale": return "snapshot-stale";
    default: return "action-failed";
  }
}
