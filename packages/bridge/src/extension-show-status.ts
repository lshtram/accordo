import type { IDEState } from "@accordo/bridge-types";
import type { CompositionDeps } from "./extension-composition-types.js";

export function createShowStatusHandler(deps: CompositionDeps): () => void {
  return (): void => {
    const isConnected = deps.state.wsClient?.isConnected() ?? false;
    const tools = deps.services.registry.getAllTools();
    const items = buildStatusItems(isConnected, tools);
    const port = deps.services.hubManager.getPort();
    const token = deps.services.hubManager.getToken();
    if (deps.showQuickPick !== undefined) {
      deps.showQuickPick(items, { canPickMany: false, title: "Accordo System Health" }).catch(() => {});
    }
    if (deps.showQuickPick === undefined || token === null) return;
    void Promise.all([fetchBrowserItems(port, token, items), fetchVoiceItems(port, token)]).then(([browserItems, voiceItems]) => {
      deps.showQuickPick?.([...items, ...browserItems, ...voiceItems], { canPickMany: false, title: "Accordo System Health" }).catch(() => {});
    });
  };
}

function buildStatusItems(isConnected: boolean, tools: ReadonlyArray<{ name: string }>): Array<{ label: string }> {
  const detected = new Set<string>();
  const prefixes: Record<string, string> = { browser_: "Browser", comment_: "Comments", accordo_diagram_: "Diagrams", accordo_presentation_: "Marp", accordo_voice_: "Voice" };
  const moduleItems = tools.flatMap((tool) => Object.entries(prefixes).flatMap(([prefix, label]) => tool.name.startsWith(prefix) && !detected.has(label) ? (detected.add(label), [{ label: `$(check) ${label}` }]) : []));
  return [{ label: isConnected ? "$(check) Hub — Connected" : "$(error) Hub — Disconnected" }, ...moduleItems];
}

async function fetchBrowserItems(port: number, token: string, baseItems: Array<{ label: string }>): Promise<Array<{ label: string }>> {
  if (!baseItems.some((item) => item.label.includes("Browser"))) return [];
  const response = await fetch(`http://127.0.0.1:${port}/browser/status`, { headers: { authorization: `Bearer ${token}`, origin: "vscode://accordo" } });
  const body = await response.json() as { connected: boolean; controlGranted: boolean };
  if (!body.connected) return [{ label: "$(error) Browser — Relay Disconnected" }];
  return [{ label: "$(check) Browser — Relay Connected" }, { label: body.controlGranted ? "$(check) Browser — User Granted Control" : "$(warning) Browser — No User Control" }];
}

async function fetchVoiceItems(port: number, token: string): Promise<Array<{ label: string }>> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/state`, { headers: { authorization: `Bearer ${token}`, origin: "vscode://accordo" } });
    const ideState = await response.json() as IDEState;
    const voiceState = ideState.modalities?.["accordo-voice"] as { ttsAvailable?: boolean } | undefined;
    return voiceState?.ttsAvailable === false ? [{ label: "$(error) Voice — TTS Unavailable" }] : [];
  } catch {
    return [];
  }
}
