import * as os from "node:os";
import * as path from "node:path";

export const ACCORDO_HOME_DIR = path.join(os.homedir(), ".accordo");

export const RELAY_PORT_FILE_NAME = "relay.port";
export const RELAY_PORT_FILE_PATH = path.join(ACCORDO_HOME_DIR, RELAY_PORT_FILE_NAME);

export const SHARED_RELAY_FILE_NAME = "shared-relay.json";
export const SHARED_RELAY_INFO_PATH = path.join(ACCORDO_HOME_DIR, SHARED_RELAY_FILE_NAME);

export const SHARED_RELAY_LOCK_FILE_NAME = "shared-relay.json.lock";
export const SHARED_RELAY_LOCK_PATH = path.join(ACCORDO_HOME_DIR, SHARED_RELAY_LOCK_FILE_NAME);

export const BROWSER_AUDIT_LOG_FILE_NAME = "browser-audit.jsonl";
export const BROWSER_AUDIT_LOG_PATH = path.join(ACCORDO_HOME_DIR, BROWSER_AUDIT_LOG_FILE_NAME);

export const SCREENSHOTS_DIR_NAME = "screenshots";
export const DEFAULT_SCREENSHOTS_DIR = path.join(ACCORDO_HOME_DIR, SCREENSHOTS_DIR_NAME);
