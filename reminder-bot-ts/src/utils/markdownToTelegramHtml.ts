/**
 * Converts common LLM markdown output to Telegram HTML.
 * Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">, <blockquote>
 */
export function markdownToTelegramHtml(text: string): string {
  // 1. Escape HTML special chars first (so raw < > & in the text don't break HTML)
  let result = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Fenced code blocks (``` ... ```) — before inline code
  result = result.replace(/```(?:\w*\n)?([\s\S]*?)```/g, (_match, code) =>
    `<pre><code>${code.trim()}</code></pre>`,
  );

  // 3. Inline code
  result = result.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 4. Bold-italic ***text*** (must be before ** and *)
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');

  // 5. Bold **text**
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // 6. Italic *text* (single asterisk, not touching **)
  result = result.replace(/\*([^*\n]+?)\*/g, '<i>$1</i>');

  // 7. Strikethrough ~~text~~
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // 8. Links [label](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 9. Headers (# / ## / ###) → bold line
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  return result;
}
