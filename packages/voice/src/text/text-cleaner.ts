/**
 * Text cleaning for TTS narration.
 *
 * M50-TC
 */

/** M50-TC-02 */
export type CleanMode = "narrate-full" | "narrate-headings";

/** M50-TC-07 */
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
/** M50-TC-06 */
const URL_RE = /https?:\/\/\S+/g;
/** M50-TC-03 */
const FENCED_CODE_RE = /```[\s\S]*?```/g;
/** M50-TC-05 block math */
const BLOCK_MATH_RE = /\$\$[\s\S]*?\$\$/g;
/** M50-TC-05 inline math */
const INLINE_MATH_RE = /\$[^$\n]+\$/g;
/** M50-TC-04 inline code */
const INLINE_CODE_RE = /`([^`]+)`/g;
/** M50-TC-09 HTML */
const HTML_TAG_RE = /<[^>]+>/g;
/** M50-TC-10 headings */
const HEADING_RE = /^#{1,6}\s+(.+)$/gm;
/** M50-TC-11 bullets: dash/star/plus */
const BULLET_DASH_RE = /^[ \t]*[-*+]\s+/gm;
/** M50-TC-11 numbered list */
const BULLET_NUM_RE = /^[ \t]*\d+\.\s+/gm;
/** M50-TC-08 bold/italic */
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_STAR_RE = /\*([^*]+)\*/g;
const BOLD_UNDER_RE = /__([^_]+)__/g;
const ITALIC_UNDER_RE = /_([^_]+)_/g;
/** M50-TC-12 emoji */
const EMOJI_RE = /\p{Emoji_Presentation}/gu;

const CODE_SNIPPET_MSG = "There's a code snippet shown on screen.";
const MATH_MSG = "There's a mathematical expression shown on screen.";
const LINK_MSG = "there's a link shown on screen";

/**
 * Transform markdown/code text into narration-friendly speech.
 * M50-TC-01 + M50-TC-17: pure function, no side effects.
 */
export function cleanTextForNarration(text: string, mode: CleanMode): string {
  if (!text) return "";

  let result = text;

  // M50-TC-03: fenced code blocks (must come before inline code)
  result = result.replace(FENCED_CODE_RE, CODE_SNIPPET_MSG);

  // M50-TC-05: block math (before inline math)
  result = result.replace(BLOCK_MATH_RE, MATH_MSG);

  // M50-TC-05: inline math
  result = result.replace(INLINE_MATH_RE, MATH_MSG);

  // M50-TC-04: inline code
  result = result.replace(INLINE_CODE_RE, (_, content: string) =>
    content.length <= 20 ? content : "a code reference",
  );

  // M50-TC-07: markdown links — keep text, strip URL
  result = result.replace(MARKDOWN_LINK_RE, "$1");

  // M50-TC-06: bare URLs
  result = result.replace(URL_RE, LINK_MSG);

  // M50-TC-09: HTML tags
  result = result.replace(HTML_TAG_RE, "");

  // M50-TC-10: headings
  result = result.replace(HEADING_RE, "Section: $1");

  // M50-TC-08: bold/italic (order matters: bold before italic)
  result = result.replace(BOLD_RE, "$1");
  result = result.replace(ITALIC_STAR_RE, "$1");
  result = result.replace(BOLD_UNDER_RE, "$1");
  result = result.replace(ITALIC_UNDER_RE, "$1");

  // M50-TC-11: bullet markers
  result = result.replace(BULLET_DASH_RE, "");
  result = result.replace(BULLET_NUM_RE, "");

  // M50-TC-12: emoji
  result = result.replace(EMOJI_RE, "");

  if (mode === "narrate-headings") {
    return _extractHeadingsSummary(result);
  }

  // M50-TC-13: multiple newlines → space
  result = result.replace(/\n{2,}/g, " ");
  result = result.replace(/\n/g, " ");

  // M50-TC-14: multiple whitespace
  result = result.replace(/\s{2,}/g, " ");

  return result.trim();
}

/** M50-TC-15: extract heading text + first sentence after each heading. */
function _extractHeadingsSummary(text: string): string {
  const lines = text.split("\n");
  const parts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith("Section:")) {
      parts.push(line);
      // Find first sentence in subsequent lines
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!.trim();
        if (next.startsWith("Section:")) break;
        if (next.length > 0) {
          const sentenceMatch = /^([^.!?]+[.!?])/.exec(next);
          parts.push(sentenceMatch ? sentenceMatch[1]!.trim() : next);
          break;
        }
      }
    }
  }

  return parts.join(" ").replace(/\s{2,}/g, " ").trim();
}

