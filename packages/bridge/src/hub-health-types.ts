/** Shared types for bridge-side Hub health probing. */
export interface HubHealthSharedState {
  port: number;
}

/** Events emitted by the health layer for HubManager to handle. */
export interface HubHealthEvents {
  onHealthy(): void;
  onTimeout(): void;
}
