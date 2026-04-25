export {
  findFreePort,
  getSecurityConfig,
  readRelayPort,
  resolveRelayToken,
  writeRelayPort,
  wireRelayServices,
} from "./relay-lifecycle-primitives.js";
export { RELAY_BASE_PORT, RELAY_HOST } from "./relay-transport-constants.js";
export type { RelayServices } from "./relay-lifecycle-primitives.js";
export {
  activatePerWindowRelay,
  activateSharedRelay,
} from "./relay-lifecycle-activation.js";
