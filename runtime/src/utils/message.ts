import type { ChatCompletionMessage, ChatCompletionMessageFunctionToolCall } from 'openai/resources';
import { File, FileCategory, FileInfo } from './file.js';
import { Folder, FolderInfo } from './folder.js';

export type FileCategorySupportOptions = {
  supported: boolean;
  extensions?: string[];
};

export const SUPPORTED_EXTENSIONS: Record<FileCategory, FileCategorySupportOptions> = {
  text: { supported: true },
  image: {
    supported: true,
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  },
  video: {
    supported: false,
    // extensions: ['mp4', 'mpeg', 'mpg', 'mov', 'avi', 'flv', 'webm', 'wmv', '3gpp']
  },
  audio: { supported: true },
  archive: { supported: false },
  binary: { supported: false },
  document: { supported: true },
  unknown: { supported: false },
};

/** OpenAI type extended with the reasoning field some models return. */
export type LLMResponse = ChatCompletionMessage & { reasoning?: string | null };

// ─── Content Types ────────────────────────────────────────────────────────────

export type LLMSimpleText = string;

export type LLMText = {
  type: 'text';
  text: string;
};

export type LLMImage = {
  type: 'image_url';
  image_url: { url: string };
};

export type LLMVideo = {
  type: 'video_url';
  video_url: { url: string };
};

/** Rich content block — text, image, or video. */
export type LLMContentPart = LLMText | LLMImage | LLMVideo;

/** Simple string or array of rich content blocks. */
export type LLMContext = LLMSimpleText | LLMContentPart | LLMContentPart[];

// ─── Tool Call ────────────────────────────────────────────────────────────────

/** A single tool call with args already parsed — no JSON serialization details. */
export type LLMToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  ico: 'image/x-icon',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
};

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  '3gp': 'video/3gpp',
  '3gpp': 'video/3gpp',
  mkv: 'video/x-matroska',
  m4v: 'video/mp4',
};

/** Build a self-closing `<file … />` tag for non-embeddable files. */
function fileDescTag(
  path: string,
  category: string,
  ext: string,
  sizeBytes: number | undefined,
  note: string,
): LLMText {
  const parts = [
    `path="${path}"`,
    `category="${category}"`,
    ext && `format="${ext}"`,
    sizeBytes != null && `size="${formatSize(sizeBytes)}"`,
    `note="${note}"`,
  ].filter(Boolean);
  return { type: 'text', text: `<file ${parts.join(' ')} />` };
}

/**
 * Convert a File to zero or more LLMContentPart values.
 * Returns null when the file's category/extension is not supported and should be skipped.
 */
function fileToContentParts(file: File): LLMContentPart[] | null {
  const support = SUPPORTED_EXTENSIONS[file.category];
  if (!support.supported) return null;
  if (support.extensions && !support.extensions.includes(file.ext)) return null;

  const { content, description, path, ext, category, sizeBytes } = file;

  switch (category) {
    case 'image': {
      if (content) {
        const mime = IMAGE_MIME[ext] ?? 'image/jpeg';
        return [{ type: 'image_url', image_url: { url: `data:${mime};base64,${content.data}` } }];
      }
      return [fileDescTag(path, category, ext, sizeBytes, description!)];
    }

    case 'video': {
      if (content) {
        const mime = VIDEO_MIME[ext] ?? 'video/mp4';
        return [{ type: 'video_url', video_url: { url: `data:${mime};base64,${content.data}` } }];
      }
      return [fileDescTag(path, category, ext, sizeBytes, description!)];
    }

    case 'text': {
      if (content) {
        return [
          { type: 'text', text: `<file path="${path}" category="text" encoding="utf-8">\n${content.data}\n</file>` },
        ];
      }
      return [fileDescTag(path, category, ext, sizeBytes, description!)];
    }

    default: {
      // document, audio, and any other supported category
      if (content) {
        const sizeAttr = sizeBytes != null ? ` size="${formatSize(sizeBytes)}"` : '';
        const extAttr = ext ? ` format="${ext}"` : '';
        return [
          {
            type: 'text',
            text: `<file path="${path}" category="${category}"${extAttr}${sizeAttr} encoding="base64">${content.data}</file>`,
          },
        ];
      }
      return [fileDescTag(path, category, ext, sizeBytes, description!)];
    }
  }
}

function folderToContentPart(path: string, tree: string): LLMText {
  return { type: 'text', text: `<folder path="${path}">\n${tree}\n</folder>` };
}

function toContentParts(item: string | File | Folder | FolderInfo | FileInfo): LLMContentPart[] {
  if (typeof item === 'string') {
    return [{ type: 'text', text: item }];
  }
  if (item instanceof File) {
    return fileToContentParts(item) ?? [];
  }
  if (item instanceof Folder) {
    return [folderToContentPart(item.path, item.tree)];
  }
  if ('tree' in item) {
    return [folderToContentPart(item.path, (item as FolderInfo).tree)];
  }
  return fileToContentParts(File.fromFileInfo(item as FileInfo)) ?? [];
}

// ─── Base ─────────────────────────────────────────────────────────────────────

export abstract class LLMMessage {
  abstract readonly role: 'system' | 'assistant' | 'user' | 'tool';
  abstract toJSON(): object;
}

// ─── SystemMessage ────────────────────────────────────────────────────────────

export class SystemMessage extends LLMMessage {
  readonly role = 'system' as const;
  readonly content: string;

  constructor(content: string) {
    super();
    this.content = content;
  }

  toJSON() {
    return { role: this.role, content: this.content };
  }
}

// ─── UserMessage ──────────────────────────────────────────────────────────────

export class UserMessage extends LLMMessage {
  readonly role = 'user' as const;
  content: LLMContext;

  constructor(content: LLMContext) {
    super();
    this.content = content;
  }

  /**
   * Build a UserMessage from a string, File, Folder, FileInfo, FolderInfo,
   * or any mix of the above in an array.
   *
   * Files/folders that are unsupported or filtered by extension are silently skipped.
   * A plain string input produces a simple-string message; everything else
   * produces an array of rich content parts.
   */
  static from(
    input: string | File | Folder | FolderInfo | FileInfo | (string | File | Folder | FolderInfo | FileInfo)[],
  ): UserMessage {
    if (typeof input === 'string') {
      return new UserMessage(input);
    }
    const parts = (Array.isArray(input) ? input : [input]).flatMap(toContentParts);
    return new UserMessage(parts);
  }

  /**
   * Append additional content to this message.
   * Converts the current content to an array of parts if needed, then appends.
   * Unsupported files/folders are silently skipped.
   * Returns `this` for chaining.
   */
  addContent(
    input: string | File | Folder | FolderInfo | FileInfo | (string | File | Folder | FolderInfo | FileInfo)[],
  ): this {
    const newParts = (Array.isArray(input) ? input : [input]).flatMap(toContentParts);
    if (newParts.length === 0) return this;

    let existing: LLMContentPart[];
    if (typeof this.content === 'string') {
      existing = this.content ? [{ type: 'text', text: this.content }] : [];
    } else if (Array.isArray(this.content)) {
      existing = this.content;
    } else {
      existing = [this.content];
    }

    this.content = [...existing, ...newParts];
    return this;
  }

  toJSON() {
    return { role: this.role, content: this.content };
  }
}

// ─── AssistantMessage (factory + base) ───────────────────────────────────────

/**
 * Base for all assistant response types.
 *
 * Use `AssistantMessage.from(llmResponse)` to resolve the concrete type,
 * then branch with instanceof:
 *   - AssistantToolCallMessage  → model wants to call tools
 *   - AssistantTextMessage      → model produced text and/or reasoning
 *   - AssistantErrorMessage     → model refused or returned nothing
 */
export abstract class AssistantMessage extends LLMMessage {
  readonly role = 'assistant' as const;

  static from(msg: LLMResponse): AssistantToolCallMessage | AssistantTextMessage | AssistantErrorMessage {
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      return AssistantToolCallMessage.fromLLMResponse(msg);
    }
    const text = msg.content?.trim() || null;
    const reasoning = msg.reasoning?.trim() || null;
    const refusal = msg.refusal?.trim() || null;
    if (text) {
      return new AssistantTextMessage({ text, reasoning });
    }
    if (reasoning) {
      return new AssistantTextMessage({ reasoning });
    }
    return new AssistantErrorMessage({ refusal });
  }
}

// ─── AssistantToolCallMessage ─────────────────────────────────────────────────

/** Model wants to invoke one or more tools (optionally with accompanying text). */
export class AssistantToolCallMessage extends AssistantMessage {
  readonly text: string | null;
  readonly toolCalls: LLMToolCall[];

  constructor(params: { text?: string | null; toolCalls: LLMToolCall[] }) {
    super();
    this.text = params.text ?? null;
    this.toolCalls = params.toolCalls;
  }

  static fromLLMResponse(msg: LLMResponse): AssistantToolCallMessage {
    return new AssistantToolCallMessage({
      text: msg.content ?? null,
      toolCalls: (msg.tool_calls ?? [])
        .filter((tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === 'function')
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {},
        })),
    });
  }

  toJSON() {
    return {
      role: this.role,
      content: this.text,
      tool_calls: this.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    };
  }
}

// ─── AssistantTextMessage ─────────────────────────────────────────────────────

/** Model produced a text reply, optionally with reasoning. */
export class AssistantTextMessage extends AssistantMessage {
  readonly text: string;
  readonly reasoning: string | null;

  constructor({ text, reasoning }: { text?: string | null; reasoning?: string | null }) {
    super();
    this.reasoning = reasoning?.trim() || null;
    const trimmed = text?.trim() || null;
    this.text = trimmed || (this.reasoning ? `No assistant response but got reasoning: ${this.reasoning}` : '');
  }

  toJSON() {
    return { role: this.role, content: this.text, reasoning: this.reasoning };
  }
}

// ─── AssistantErrorMessage ────────────────────────────────────────────────────

/** Error response — model either refused or returned nothing usable. */
export class AssistantErrorMessage extends AssistantMessage {
  /** Refusal reason when the model explicitly declined; null for empty responses. */
  readonly refusal: string | null;
  /** Human-readable error description. */
  readonly error: string;

  constructor({ refusal }: { refusal: string | null }) {
    super();
    this.refusal = refusal?.trim() || null;
    this.error = this.refusal ? `Refused. Reason: ${this.refusal}` : 'No response';
  }

  toJSON() {
    return { role: this.role, content: null, refusal: this.refusal };
  }
}

// ─── ToolResultMessage ────────────────────────────────────────────────────────

/** Result of a tool call — content can be simple text or rich text blocks. */
export class ToolResultMessage extends LLMMessage {
  readonly role = 'tool' as const;
  readonly toolCallId: string;
  readonly content: string | LLMText[];

  constructor({ toolCallId, content }: { toolCallId: string; content: string | LLMText[] }) {
    super();
    this.toolCallId = toolCallId;
    this.content = content;
  }

  toJSON() {
    return { role: this.role, tool_call_id: this.toolCallId, content: this.content };
  }
}
