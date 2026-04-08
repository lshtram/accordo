/**
 * FC-05 — HTML entity decoder for Mermaid label text.
 *
 * Mermaid's parser may output HTML-encoded characters in node and edge labels.
 * This utility decodes them back to plain text for Excalidraw rendering.
 *
 * Handles:
 * - Named entities: &amp; &lt; &gt; &quot; &#39;  (the 5 XML predefined entities)
 * - Decimal numeric entities: &#60; &#8364;
 * - Hex numeric entities: &#x3C; &#x1F600;
 * - Unknown named entities pass through unchanged
 *
 * Requirements: FC-05a through FC-05e
 * @module
 */

/**
 * Decode HTML entities in a string to their corresponding characters.
 *
 * @param text - Input text potentially containing HTML entities
 * @returns Text with HTML entities replaced by their decoded characters
 *
 * @example
 * ```ts
 * decodeHtmlEntities("A &amp; B")     // → "A & B"
 * decodeHtmlEntities("&#60;div&#62;") // → "<div>"
 * decodeHtmlEntities("&#x1F600;")     // → "😀"
 * decodeHtmlEntities("&foobar;")      // → "&foobar;" (unknown, unchanged)
 * ```
 */
export function decodeHtmlEntities(text: string): string {
  // Named entities (FC-05b): the 5 XML predefined entities
  const namedMap: ReadonlyMap<string, string> = new Map([
    ["amp",  "&"],
    ["lt",   "<"],
    ["gt",   ">"],
    ["quot", '"'],
    ["apos", "'"],
  ]);

  let result = text;

  // Named entities: &name;
  result = result.replace(/&(\w+);/g, (match, name) => {
    const decoded = namedMap.get(name.toLowerCase());
    return decoded !== undefined ? decoded : match;
  });

  // Decimal numeric entities: &#NNN;
  result = result.replace(/&#(\d+);/g, (match, numStr) => {
    const codePoint = parseInt(numStr, 10);
    if (!isNaN(codePoint) && codePoint > 0 && codePoint <= 0x10FFFF) {
      return String.fromCodePoint(codePoint);
    }
    return match;
  });

  // Hex numeric entities: &#xHHHH; (case-insensitive x/X)
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (match, hexStr) => {
    const codePoint = parseInt(hexStr, 16);
    if (!isNaN(codePoint) && codePoint > 0 && codePoint <= 0x10FFFF) {
      return String.fromCodePoint(codePoint);
    }
    return match;
  });

  return result;
}
