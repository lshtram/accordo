/**
 * Minimal test plugin — confirms plugins are loading
 */
import type { Plugin } from "@opencode-ai/plugin";

export const TestPlugin: Plugin = async ({ client, directory }) => {
  await client.app.log({ body: { service: "test-plugin", level: "info", message: `TestPlugin loaded, directory: ${directory}` } });

  return {
    event: async ({ event }) => {
      await client.app.log({ body: { service: "test-plugin", level: "info", message: `Event: ${event.type}, sessionId: ${event.sessionId}` } });
    },
  };
};

export default TestPlugin;
