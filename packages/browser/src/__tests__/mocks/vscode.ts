import { vi } from "vitest";

export class Disposable {
  constructor(private readonly fn: () => void) {}
  dispose(): void {
    this.fn();
  }
}

export function createExtensionContextMock() {
  const state = new Map<string, unknown>();
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    globalState: {
      get: vi.fn((k: string) => state.get(k)),
      update: vi.fn(async (k: string, v: unknown) => {
        state.set(k, v);
      }),
    },
  };
}

export const extensions = {
  getExtension: vi.fn(() => undefined),
};

export const window = {
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    dispose: vi.fn(),
  })),
};

export const workspace = {
  getConfiguration: vi.fn((_section: string) => ({
    get: vi.fn(<T>(key: string, defaultValue?: T): T => defaultValue as T),
  })),
};

export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
};

export default {
  extensions,
  window,
  workspace,
  commands,
  Disposable,
};
