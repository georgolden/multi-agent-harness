/**
 * Converts common LLM markdown output to Telegram HTML.
 * Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">, <blockquote>
 */
export declare function markdownToTelegramHtml(text: string): string;
