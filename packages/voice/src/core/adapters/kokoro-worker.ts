import * as readline from "node:readline";
import { KokoroAdapter } from "./kokoro.js";

function send(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

let adapter: KokoroAdapter | null = null;

interface WorkerRequest {
  id: string;
  type: string;
  text?: string;
  language?: string;
  voice?: string;
  speed?: number;
}

async function handleInit(id: string): Promise<void> {
  try {
    adapter = new KokoroAdapter();
    send({ id, type: "ready" });
  } catch (err) {
    send({ id, type: "error", message: String(err) });
  }
}

async function handleSynthesize(req: WorkerRequest): Promise<void> {
  if (!adapter) {
    send({ id: req.id, type: "error", message: "engine not initialized" });
    return;
  }
  try {
    const result = await adapter.synthesize({
      text: req.text ?? "",
      language: req.language ?? "en-US",
      voice: req.voice,
      speed: req.speed,
    });
    send({
      id: req.id,
      type: "audio",
      pcmBase64: Buffer.from(result.audio).toString("base64"),
      sampleRate: result.sampleRate,
    });
  } catch (err) {
    send({ id: req.id, type: "error", message: String(err) });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: WorkerRequest;
  try {
    req = JSON.parse(trimmed) as WorkerRequest;
  } catch {
    return;
  }
  if (req.type === "init") {
    void handleInit(req.id);
  } else if (req.type === "synthesize") {
    void handleSynthesize(req);
  }
});

rl.on("close", () => {
  void adapter?.dispose();
  process.exit(0);
});
