/**
 * Structured diagnostic recorder for Priority T rebind probes.
 * Implements HubRebindDiagnosticSink and writes JSON records to OutputChannel.
 *
 * Requirements: requirements-bridge.md §4 (LCM-16)
 */
import type { OutputChannel } from "./hub-manager-state.js";
import type { HubRebindDiagnosticSink, HubRebindProbeReport } from "./hub-rebind-types.js";

/** Structured diagnostic sink that writes JSON records to OutputChannel. */
export class HubRebindDiagnosticRecorder implements HubRebindDiagnosticSink {
  constructor(private readonly output: OutputChannel) {}

  record(report: HubRebindProbeReport): void {
    // LCM-16: no token/secret fields — only structural rebind fields
    const record_ = {
      projectId: report.projectId,
      registryPath: report.registryPath,
      outcome: report.outcome,
      reusable: report.reusable,
      pid: report.pid,
      port: report.port,
      bridge: report.bridge,
      toolCount: report.toolCount,
      protocolVersion: report.protocolVersion,
    };
    this.output.appendLine(`[accordo-bridge] rebind-probe ${JSON.stringify(record_)}`);
  }
}
