import { syncMcpSettings } from "./extension-bootstrap.js";
import type { CompositionDeps } from "./extension-composition-types.js";
import { writeAgentConfigsFromStorage, type AgentConfigTokenSource } from "./agent-config-sync.js";
import { scopedSecretKey, HUB_TOKEN_KEY } from "./project-identity.js";

export function requestConfigSyncs(
  deps: CompositionDeps,
  port: number,
  token: string,
): void {
  requestCopilotSync(deps, port, token);
  requestWorkspaceSync(deps, port);
}

function requestCopilotSync(
  deps: CompositionDeps,
  port: number,
  token: string,
): void {
  if (!deps.bootstrap.config.wantCopilot) return;
  syncMcpSettings(deps.bootstrap.outputChannel, deps.bootstrap.mcpConfigPath, port, token).catch((err: unknown) => {
    deps.bootstrap.outputChannel.appendLine(
      `[accordo-bridge] syncMcpSettings error: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

function requestWorkspaceSync(
  deps: CompositionDeps,
  port: number,
): void {
  if (!deps.bootstrap.config.wantOpencode && !deps.bootstrap.config.wantClaude) return;
  const target = deps.bootstrap.config.workspaceRoot
    ? { kind: "workspace" as const, workspaceRoot: deps.bootstrap.config.workspaceRoot }
    : { kind: "none" as const };
  const tokenSource: AgentConfigTokenSource = {
    getHubToken: async (projectId: string) => {
      return deps.bootstrap.secretStorage.get(scopedSecretKey(HUB_TOKEN_KEY, projectId));
    },
  };
  writeAgentConfigsFromStorage({
    projectId: deps.bootstrap.config.projectId,
    port,
    configureOpencode: deps.bootstrap.config.wantOpencode,
    configureClaude: deps.bootstrap.config.wantClaude,
    target,
    tokenSource,
    outputChannel: deps.bootstrap.outputChannel,
  }).catch((err: unknown) => {
    deps.bootstrap.outputChannel.appendLine(
      `[accordo-bridge] writeAgentConfigsFromStorage error: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}
