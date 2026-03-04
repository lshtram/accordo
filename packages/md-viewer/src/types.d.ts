/**
 * Ambient type declarations for packages that lack @types/* definitions.
 */

declare module "@hackmd/markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  function taskLists(md: MarkdownIt, options?: Record<string, unknown>): void;
  export default taskLists;
}
