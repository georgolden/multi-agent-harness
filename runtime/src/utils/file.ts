import fs from 'node:fs/promises';
import nodePath from 'node:path';

// ─── Category ─────────────────────────────────────────────────────────────────

export type FileCategory =
  | 'text' // source code, plain text, config, markup
  | 'image' // jpg, png, gif, webp, etc
  | 'video' // mp4, mov, webm, etc
  | 'audio' // mp3, wav, ogg, etc
  | 'document' // pdf, docx, xlsx, pptx — binary but LLM-passable as base64
  | 'archive' // zip, tar, gz, rar — description only
  | 'binary' // exe, dll, elf, wasm, CAD, DB, etc — description only
  | 'unknown';

// ─── Content ──────────────────────────────────────────────────────────────────

export interface FileContent {
  /** utf-8 for text files, base64 for image/video/audio/document */
  encoding: 'utf-8' | 'base64';
  data: string;
}

// ─── Limits ───────────────────────────────────────────────────────────────────

export interface ReadLimits {
  /** Hard cap — nothing gets read above this. Default: 200MB */
  maxFileSizeBytes: number;
  /** Text files (source, config, markup). Default: 10MB */
  maxTextSizeBytes: number;
  /** Images, video, audio. Default: 100MB */
  maxMediaSizeBytes: number;
  /** PDF, Office files. Default: 50MB */
  maxDocumentSizeBytes: number;
}

const DEFAULT_LIMITS: ReadLimits = {
  maxFileSizeBytes: 200 * 1024 * 1024,
  maxTextSizeBytes: 10 * 1024 * 1024,
  maxMediaSizeBytes: 100 * 1024 * 1024,
  maxDocumentSizeBytes: 50 * 1024 * 1024,
};

// ─── Extension Sets ───────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mpeg', 'mpg', 'mov', 'avi', 'flv', 'webm', 'wmv', '3gp', '3gpp', 'mkv', 'm4v']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus', 'aiff', 'au']);
const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'xz', 'tgz', 'zst', 'lz4', 'cab', 'iso', 'dmg']);
const DOCUMENT_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'rtf',
  'epub',
  'mobi',
  'pages',
  'numbers',
  'key',
]);
const SPECIALIZED_EXTS = new Set([
  // CAD / 3D
  'dwg',
  'dxf',
  'blend',
  'fbx',
  'obj',
  'stl',
  'step',
  'iges',
  'stp',
  // Database
  'sqlite',
  'db',
  'mdb',
  'accdb',
  // Design
  'psd',
  'ai',
  'xd',
  'fig',
  'sketch',
  'afdesign',
  // Font
  'ttf',
  'otf',
  'woff',
  'woff2',
  'eot',
]);
const BINARY_EXTS = new Set([
  'exe',
  'dll',
  'so',
  'dylib',
  'elf',
  'bin',
  'com',
  'sys',
  'drv',
  'o',
  'a',
  'lib',
  'class',
  'pyc',
  'pyo',
  'pyd',
  'wasm',
  'vmdk',
  'vhd',
  'vdi',
  'img',
  'rom',
  'fw',
  'der',
  'p12',
  'pfx',
  'keystore',
]);

// ─── Magic Bytes ──────────────────────────────────────────────────────────────

interface MagicEntry {
  bytes: number[]; // -1 = wildcard
  offset?: number;
  category: FileCategory;
  ext: string;
}

const MAGIC: MagicEntry[] = [
  // Images
  { bytes: [0xff, 0xd8, 0xff], category: 'image', ext: 'jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], category: 'image', ext: 'png' },
  { bytes: [0x47, 0x49, 0x46, 0x38], category: 'image', ext: 'gif' },
  { bytes: [0x42, 0x4d], category: 'image', ext: 'bmp' },
  // Video
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], category: 'video', ext: 'webm' },
  { bytes: [0x00, 0x00, 0x00, -1, 0x66, 0x74, 0x79, 0x70], category: 'video', ext: 'mp4' },
  // Audio
  { bytes: [0xff, 0xfb], category: 'audio', ext: 'mp3' },
  { bytes: [0xff, 0xf3], category: 'audio', ext: 'mp3' },
  { bytes: [0xff, 0xf2], category: 'audio', ext: 'mp3' },
  { bytes: [0x49, 0x44, 0x33], category: 'audio', ext: 'mp3' },
  { bytes: [0x4f, 0x67, 0x67, 0x53], category: 'audio', ext: 'ogg' },
  { bytes: [0x66, 0x4c, 0x61, 0x43], category: 'audio', ext: 'flac' },
  // Archives
  { bytes: [0x50, 0x4b, 0x03, 0x04], category: 'archive', ext: 'zip' },
  { bytes: [0x50, 0x4b, 0x05, 0x06], category: 'archive', ext: 'zip' },
  { bytes: [0x1f, 0x8b], category: 'archive', ext: 'gz' },
  { bytes: [0x42, 0x5a, 0x68], category: 'archive', ext: 'bz2' },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], category: 'archive', ext: '7z' },
  { bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], category: 'archive', ext: 'rar' },
  { bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], category: 'archive', ext: 'xz' },
  // Documents
  { bytes: [0x25, 0x50, 0x44, 0x46], category: 'document', ext: 'pdf' },
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], category: 'document', ext: 'doc' },
  // Binaries
  { bytes: [0x7f, 0x45, 0x4c, 0x46], category: 'binary', ext: 'elf' },
  { bytes: [0x4d, 0x5a], category: 'binary', ext: 'exe' },
  { bytes: [0xce, 0xfa, 0xed, 0xfe], category: 'binary', ext: 'macho' },
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], category: 'binary', ext: 'macho' },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], category: 'binary', ext: 'class' },
  { bytes: [0x00, 0x61, 0x73, 0x6d], category: 'binary', ext: 'wasm' },
];

function detectByMagic(header: Buffer): { category: FileCategory; ext: string } | null {
  // RIFF container — WAV, AVI, or WEBP depending on bytes 8–11
  if (header.length >= 12 && header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
    const sub = header.subarray(8, 12).toString('ascii');
    if (sub === 'WAVE') return { category: 'audio', ext: 'wav' };
    if (sub === 'AVI ') return { category: 'video', ext: 'avi' };
    if (sub === 'WEBP') return { category: 'image', ext: 'webp' };
  }

  for (const entry of MAGIC) {
    const off = entry.offset ?? 0;
    if (header.length < off + entry.bytes.length) continue;
    if (entry.bytes.every((b, i) => b === -1 || header[off + i] === b))
      return { category: entry.category, ext: entry.ext };
  }

  return null;
}

// ─── Text Heuristic ───────────────────────────────────────────────────────────

function looksLikeText(buf: Buffer): boolean {
  if (buf.includes(0x00)) return false;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    let printable = 0;
    for (let i = 0; i < decoded.length; i++) {
      const c = decoded.charCodeAt(i);
      if (c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c > 0x7f) printable++;
    }
    return printable / decoded.length > 0.85;
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

function extOf(filePath: string): string {
  return nodePath.extname(filePath).replace('.', '').toLowerCase();
}

function categoryFromExt(ext: string): FileCategory {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (DOCUMENT_EXTS.has(ext)) return 'document';
  if (SPECIALIZED_EXTS.has(ext)) return 'binary';
  if (BINARY_EXTS.has(ext)) return 'binary';
  return 'unknown';
}

function buildDescription(
  name: string,
  category: FileCategory,
  ext: string,
  detectedExt: string | undefined,
  sizeBytes: number,
): string {
  const fmt = detectedExt && detectedExt !== ext ? `${ext} (detected: ${detectedExt})` : ext || 'unknown';
  const notes: Partial<Record<FileCategory, string>> = {
    archive: 'Compressed archive — extract to access contents.',
    binary: 'Binary or specialized file — cannot be read as text.',
    unknown: 'File type could not be determined.',
  };
  const note = notes[category] ?? '';
  return `File "${name}" — category: ${category}, format: ${fmt}, size: ${formatSize(sizeBytes)}${note ? '. ' + note : ''}`;
}

// ─── File ─────────────────────────────────────────────────────────────────────

// Context file reference
export interface FileInfo {
  path: string;
  content?: FileContent;
  description?: string;
  category: FileCategory;
}

export class File {
  readonly path: string;
  readonly category: FileCategory;
  readonly ext: string;
  readonly detectedExt: string | undefined;
  readonly sizeBytes: number | undefined;

  /**
   * Set when file was successfully read.
   * encoding 'utf-8'  → text (source code, config, markup)
   * encoding 'base64' → image, video, audio, document
   */
  readonly content: FileContent | undefined;

  /**
   * Set when content was not read:
   * too large, binary, archive, specialized format, unknown.
   */
  readonly description: string | undefined;

  private constructor(params: {
    path: string;
    category: FileCategory;
    ext: string;
    detectedExt?: string;
    sizeBytes?: number;
    content?: FileContent;
    description?: string;
  }) {
    this.path = params.path;
    this.category = params.category;
    this.ext = params.ext;
    this.detectedExt = params.detectedExt;
    this.sizeBytes = params.sizeBytes;
    this.content = params.content;
    this.description = params.description;
  }

  get name(): string {
    return nodePath.basename(this.path);
  }

  // ── Static factories (manual construction) ────────────────────────────────

  static fromFileInfo({ path, content, description, category }: FileInfo): File {
    return new File({ path, category, ext: extOf(path), content, description });
  }

  static fromText({ path, content }: { path: string; content: string }): File {
    return new File({ path, category: 'text', ext: extOf(path), content: { encoding: 'utf-8', data: content } });
  }

  static fromImage({ path, content }: { path: string; content: string }): File {
    return new File({ path, category: 'image', ext: extOf(path), content: { encoding: 'base64', data: content } });
  }

  static fromVideo({ path, content }: { path: string; content: string }): File {
    return new File({ path, category: 'video', ext: extOf(path), content: { encoding: 'base64', data: content } });
  }

  static fromAudio({ path, content }: { path: string; content: string }): File {
    return new File({ path, category: 'audio', ext: extOf(path), content: { encoding: 'base64', data: content } });
  }

  static fromDocument({ path, content }: { path: string; content: string }): File {
    return new File({ path, category: 'document', ext: extOf(path), content: { encoding: 'base64', data: content } });
  }

  // ── Read from disk ────────────────────────────────────────────────────────

  static async read(filePath: string, options: { limits?: Partial<ReadLimits> } = {}): Promise<File> {
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const ext = extOf(filePath);
    const stat = await fs.stat(filePath);
    const size = stat.size;
    const name = nodePath.basename(filePath);

    // ── Hard cap ──────────────────────────────────────────────────────────────
    if (size > limits.maxFileSizeBytes) {
      return new File({
        path: filePath,
        category: categoryFromExt(ext),
        ext,
        sizeBytes: size,
        description: `File "${name}" (${formatSize(size)}) exceeds the read limit of ${formatSize(limits.maxFileSizeBytes)}.`,
      });
    }

    // ── Read 16-byte header for magic detection ───────────────────────────────
    const header = Buffer.alloc(16);
    const fh = await fs.open(filePath, 'r');
    await fh.read(header, 0, 16, 0);
    await fh.close();

    const magic = detectByMagic(header);
    const category = magic?.category ?? categoryFromExt(ext);

    // ── Archives and binaries: description only ───────────────────────────────
    if (category === 'archive' || category === 'binary') {
      return new File({
        path: filePath,
        category,
        ext,
        detectedExt: magic?.ext,
        sizeBytes: size,
        description: buildDescription(name, category, ext, magic?.ext, size),
      });
    }

    // ── Documents: base64 ────────────────────────────────────────────────────
    if (category === 'document') {
      if (size > limits.maxDocumentSizeBytes) {
        return new File({
          path: filePath,
          category,
          ext,
          detectedExt: magic?.ext,
          sizeBytes: size,
          description: `File "${name}" (${formatSize(size)}) exceeds the document read limit of ${formatSize(limits.maxDocumentSizeBytes)}.`,
        });
      }
      const buf = await fs.readFile(filePath);
      return new File({
        path: filePath,
        category,
        ext,
        detectedExt: magic?.ext,
        sizeBytes: size,
        content: { encoding: 'base64', data: buf.toString('base64') },
      });
    }

    // ── Media: base64 ────────────────────────────────────────────────────────
    if (category === 'image' || category === 'video' || category === 'audio') {
      if (size > limits.maxMediaSizeBytes) {
        return new File({
          path: filePath,
          category,
          ext,
          detectedExt: magic?.ext,
          sizeBytes: size,
          description: `File "${name}" (${formatSize(size)}) exceeds the media read limit of ${formatSize(limits.maxMediaSizeBytes)}.`,
        });
      }
      const buf = await fs.readFile(filePath);
      return new File({
        path: filePath,
        category,
        ext,
        detectedExt: magic?.ext,
        sizeBytes: size,
        content: { encoding: 'base64', data: buf.toString('base64') },
      });
    }

    // ── Text / unknown: utf-8 with heuristic check ───────────────────────────
    if (size > limits.maxTextSizeBytes) {
      return new File({
        path: filePath,
        category: 'text',
        ext,
        sizeBytes: size,
        description: `File "${name}" (${formatSize(size)}) exceeds the text read limit of ${formatSize(limits.maxTextSizeBytes)}.`,
      });
    }

    const buf = await fs.readFile(filePath);

    if (!looksLikeText(buf.subarray(0, 8192))) {
      return new File({
        path: filePath,
        category: 'binary',
        ext,
        detectedExt: magic?.ext,
        sizeBytes: size,
        description: buildDescription(name, 'binary', ext, magic?.ext, size),
      });
    }

    return new File({
      path: filePath,
      category: 'text',
      ext,
      sizeBytes: size,
      content: { encoding: 'utf-8', data: buf.toString('utf-8') },
    });
  }
}
