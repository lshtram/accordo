export {
  findFreePort,
  getSecurityConfig,
  readRelayPort,
  resolveRelayToken,
  writeRelayPort,
  wireRelayServices,
} from "./relay-lifecycle-primitives.js";
export type { RelayServices } from "./relay-lifecycle-primitives.js";
export {
  activatePerWindowRelay,
  activateSharedRelay,
} from "./relay-lifecycle-activation.js";
