import * as fs from "node:fs";
import * as path from "node:path";

const THRESHOLD_KEY = "github.copilot.chat.virtualTools.threshold";
const THRESHOLD_VALUE = 300;

export function writeVscodeSettings(
  workspaceRoot: string,
  outputChannel?: { appendLine(value: string): void },
): boolean {
  const vscodeDir = path.join(workspaceRoot, ".vscode");
  const settingsPath = path.join(vscodeDir, "settings.json");
  const settings = readSettingsFile(settingsPath, outputChannel);
  const existing = settings[THRESHOLD_KEY];
  if (typeof existing === "number" && existing >= THRESHOLD_VALUE) return false;
  settings[THRESHOLD_KEY] = THRESHOLD_VALUE;
  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4) + "\n", { encoding: "utf8" });
  outputChannel?.appendLine(`[accordo-bridge] .vscode/settings.json: set ${THRESHOLD_KEY}=${THRESHOLD_VALUE} ✓`);
  return true;
}

export function removeWorkspaceThreshold(
  workspaceRoot: string,
  outputChannel?: { appendLine(value: string): void },
): void {
  const settingsPath = path.join(workspaceRoot, ".vscode", "settings.json");
  const settings = readExistingSettings(settingsPath);
  if (settings === null || !(THRESHOLD_KEY in settings)) return;
  delete settings[THRESHOLD_KEY];
  if (Object.keys(settings).length === 0) fs.unlinkSync(settingsPath);
  else fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4) + "\n", { encoding: "utf8" });
  outputChannel?.appendLine(`[accordo-bridge] Removed stale ${THRESHOLD_KEY} from workspace .vscode/settings.json ✓`);
}

function readSettingsFile(
  settingsPath: string,
  outputChannel?: { appendLine(value: string): void },
): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof Error && error.name !== "SyntaxError") return {};
  }
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    fs.writeFileSync(settingsPath + ".bak", raw, "utf8");
    outputChannel?.appendLine("[accordo-bridge] .vscode/settings.json was corrupt — backed up as settings.json.bak");
  } catch {
    // file absent
  }
  return {};
}

function readExistingSettings(settingsPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
