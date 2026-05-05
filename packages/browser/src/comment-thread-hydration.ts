import type { CommentThread } from "@accordo/bridge-types";

export interface CommentHydrationDeps {
  invokeTool(toolName: string, args: Record<string, unknown>, timeout?: number): Promise<unknown>;
}

export interface HydrateCommentsArgs {
  scope: { modality: "browser"; url?: string };
}

export async function hydrateBrowserCommentThreads(
  deps: CommentHydrationDeps,
  args: HydrateCommentsArgs,
): Promise<{ threads: CommentThread[] }> {
  const listResult = await deps.invokeTool("comment_list", { scope: args.scope }, undefined);
  const summaries = extractSummaries(listResult);
  const threads: CommentThread[] = [];

  for (const summary of summaries) {
    try {
      const fullResult = await deps.invokeTool("comment_get", { threadId: summary.id }, undefined);
      const thread = extractThread(fullResult);
      if (thread !== undefined) threads.push(thread);
    } catch {
      // Skip vanished/missing thread errors and continue hydration.
    }
  }

  return { threads };
}

function extractSummaries(result: unknown): Array<{ id: string }> {
  if (typeof result !== "object" || result === null || !("threads" in result)) return [];
  const threads = (result as { threads?: unknown }).threads;
  if (!Array.isArray(threads)) return [];
  return threads
    .map((item) => {
      if (typeof item !== "object" || item === null) return undefined;
      const id = (item as { id?: unknown }).id;
      return typeof id === "string" ? { id } : undefined;
    })
    .filter((item): item is { id: string } => item !== undefined);
}

function extractThread(result: unknown): CommentThread | undefined {
  if (typeof result !== "object" || result === null || !("thread" in result)) return undefined;
  const thread = (result as { thread?: unknown }).thread;
  if (typeof thread !== "object" || thread === null) return undefined;
  return thread as CommentThread;
}
