export type TransportState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface RelayTransportEvents {
  onStateChange?: (state: TransportState) => void;
  onMessage?: (data: string) => void;
  onError?: (error: string) => void;
}
