import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import { File } from './file.js';

// ── Temp dir helpers ───────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'file-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function write(name: string, content: Buffer | string): Promise<string> {
  const path = nodePath.join(tmpDir, name);
  await fs.writeFile(path, content);
  return path;
}

// Build a 16-byte buffer with the given bytes at positions 0…n, rest zeroed.
function magicBuf(...bytes: number[]): Buffer {
  const buf = Buffer.alloc(16);
  bytes.forEach((b, i) => { buf[i] = b; });
  return buf;
}

// RIFF container header (16 bytes): RIFF + LE size + 4-char sub-type.
function riffBuf(sub: string): Buffer {
  const buf = Buffer.alloc(16);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(1000, 4);
  buf.write(sub.slice(0, 4).padEnd(4, ' '), 8, 'ascii');
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Static factories
// ─────────────────────────────────────────────────────────────────────────────

describe('File static factories', () => {
  it('fromText — sets path, category, ext, utf-8 content', () => {
    const file = File.fromText({ path: '/src/main.ts', content: 'const x = 1;' });
    expect(file.path).toBe('/src/main.ts');
    expect(file.category).toBe('text');
    expect(file.ext).toBe('ts');
    expect(file.content).toEqual({ encoding: 'utf-8', data: 'const x = 1;' });
    expect(file.description).toBeUndefined();
    expect(file.sizeBytes).toBeUndefined();
  });

  it('fromImage — sets category image, base64 content', () => {
    const file = File.fromImage({ path: '/assets/photo.jpg', content: 'abc123==' });
    expect(file.category).toBe('image');
    expect(file.ext).toBe('jpg');
    expect(file.content).toEqual({ encoding: 'base64', data: 'abc123==' });
    expect(file.description).toBeUndefined();
  });

  it('fromVideo — sets category video, base64 content', () => {
    const file = File.fromVideo({ path: '/clips/movie.mp4', content: 'xyz==' });
    expect(file.category).toBe('video');
    expect(file.ext).toBe('mp4');
    expect(file.content).toEqual({ encoding: 'base64', data: 'xyz==' });
  });

  it('fromAudio — sets category audio, base64 content', () => {
    const file = File.fromAudio({ path: '/sounds/track.mp3', content: 'bbb==' });
    expect(file.category).toBe('audio');
    expect(file.ext).toBe('mp3');
    expect(file.content).toEqual({ encoding: 'base64', data: 'bbb==' });
  });

  it('fromDocument — sets category document, base64 content', () => {
    const file = File.fromDocument({ path: '/docs/report.pdf', content: 'ccc==' });
    expect(file.category).toBe('document');
    expect(file.ext).toBe('pdf');
    expect(file.content).toEqual({ encoding: 'base64', data: 'ccc==' });
  });

  it('name getter — returns basename', () => {
    const file = File.fromText({ path: '/deep/nested/path/file.ts', content: '' });
    expect(file.name).toBe('file.ts');
  });

  it('name getter — works with flat path', () => {
    const file = File.fromText({ path: 'readme.md', content: '' });
    expect(file.name).toBe('readme.md');
  });

  it('detectedExt is undefined for factory-created files', () => {
    const file = File.fromImage({ path: '/img.png', content: '' });
    expect(file.detectedExt).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File.read — text
// ─────────────────────────────────────────────────────────────────────────────

describe('File.read — text files', () => {
  it('reads a UTF-8 source file', async () => {
    const src = 'const x = 42;\nconsole.log(x);\n';
    const path = await write('hello.ts', src);
    const file = await File.read(path);

    expect(file.category).toBe('text');
    expect(file.ext).toBe('ts');
    expect(file.content?.encoding).toBe('utf-8');
    expect(file.content?.data).toBe(src);
    expect(file.sizeBytes).toBe(Buffer.byteLength(src));
    expect(file.description).toBeUndefined();
    expect(file.detectedExt).toBeUndefined();
  });

  it('reads an unknown-extension file as text when content is printable UTF-8', async () => {
    const src = 'This is plain text.\nWith multiple lines.\n';
    const path = await write('data.xyz', src);
    const file = await File.read(path);

    expect(file.category).toBe('text');
    expect(file.content?.encoding).toBe('utf-8');
    expect(file.content?.data).toBe(src);
  });

  it('returns description when text file exceeds maxTextSizeBytes', async () => {
    const src = 'a'.repeat(200);
    const path = await write('big.ts', src);
    const file = await File.read(path, { limits: { maxTextSizeBytes: 100 } });

    expect(file.content).toBeUndefined();
    expect(file.description).toContain('"big.ts"');
    expect(file.description).toContain('text read limit');
  });

  it('returns description when file exceeds hard maxFileSizeBytes cap', async () => {
    const path = await write('capped.txt', 'hello world\n');
    const file = await File.read(path, { limits: { maxFileSizeBytes: 5 } });

    expect(file.content).toBeUndefined();
    expect(file.description).toContain('"capped.txt"');
    expect(file.description).toContain('exceeds the read limit');
  });

  it('custom limits override defaults', async () => {
    const src = 'hello\n';
    const path = await write('small.txt', src);
    const file = await File.read(path, { limits: { maxTextSizeBytes: 1024 } });

    expect(file.content?.data).toBe(src);
  });

  it('classifies unknown-extension file with null bytes as binary via heuristic', async () => {
    const buf = Buffer.concat([
      Buffer.from('Some readable text '),
      Buffer.from([0x00]),
      Buffer.from(' followed by null'),
    ]);
    const path = await write('nullbytes.xyz', buf);
    const file = await File.read(path);

    expect(file.category).toBe('binary');
    expect(file.content).toBeUndefined();
    expect(file.description).toBeDefined();
  });

  it('sizeBytes reflects actual file size on disk', async () => {
    const src = 'hello world!';
    const path = await write('sized.txt', src);
    const file = await File.read(path);

    expect(file.sizeBytes).toBe(Buffer.byteLength(src, 'utf-8'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File.read — images
// ─────────────────────────────────────────────────────────────────────────────

describe('File.read — image files', () => {
  it('detects PNG by magic bytes', async () => {
    const path = await write('img.png', magicBuf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
    const file = await File.read(path);

    expect(file.category).toBe('image');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBe('png');
    expect(file.description).toBeUndefined();
  });

  it('detects JPEG by magic bytes', async () => {
    const path = await write('photo.jpg', magicBuf(0xff, 0xd8, 0xff, 0xe0));
    const file = await File.read(path);

    expect(file.category).toBe('image');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBe('jpeg');
  });

  it('detects GIF by magic bytes', async () => {
    const path = await write('anim.gif', magicBuf(0x47, 0x49, 0x46, 0x38));
    const file = await File.read(path);

    expect(file.category).toBe('image');
    expect(file.detectedExt).toBe('gif');
  });

  it('detects BMP by magic bytes', async () => {
    const path = await write('icon.bmp', magicBuf(0x42, 0x4d));
    const file = await File.read(path);

    expect(file.category).toBe('image');
    expect(file.detectedExt).toBe('bmp');
  });

  it('detects WEBP via RIFF sub-type', async () => {
    const path = await write('photo.webp', riffBuf('WEBP'));
    const file = await File.read(path);

    expect(file.category).toBe('image');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBe('webp');
  });

  it('falls back to extension when no magic match', async () => {
    const path = await write('nomagic.jpg', Buffer.from([0x01, 0x02, 0x03, 0x04]));
    const file = await File.read(path);

    expect(file.category).toBe('image');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBeUndefined();
  });

  it('returns description when image exceeds maxMediaSizeBytes', async () => {
    const path = await write('huge.png', magicBuf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
    const file = await File.read(path, { limits: { maxMediaSizeBytes: 4 } });

    expect(file.content).toBeUndefined();
    expect(file.description).toContain('"huge.png"');
    expect(file.description).toContain('media read limit');
  });

  it('sets detectedExt when magic does not match file extension', async () => {
    // PNG bytes inside a .bin file
    const path = await write('sneaky.bin', magicBuf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
    const file = await File.read(path);

    expect(file.category).toBe('image');
    expect(file.ext).toBe('bin');
    expect(file.detectedExt).toBe('png');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File.read — video
// ─────────────────────────────────────────────────────────────────────────────

describe('File.read — video files', () => {
  it('detects WEBM by magic bytes', async () => {
    const path = await write('clip.webm', magicBuf(0x1a, 0x45, 0xdf, 0xa3));
    const file = await File.read(path);

    expect(file.category).toBe('video');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBe('webm');
  });

  it('detects MP4 by magic bytes (ftyp box)', async () => {
    // 00 00 00 XX 66 74 79 70 ("....ftyp") — byte 3 is wildcard
    const path = await write('movie.mp4', magicBuf(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70));
    const file = await File.read(path);

    expect(file.category).toBe('video');
    expect(file.detectedExt).toBe('mp4');
  });

  it('detects AVI via RIFF sub-type', async () => {
    const path = await write('old.avi', riffBuf('AVI '));
    const file = await File.read(path);

    expect(file.category).toBe('video');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBe('avi');
  });

  it('falls back to extension for video', async () => {
    const path = await write('nomagic.mov', Buffer.from([0x01, 0x02, 0x03, 0x04]));
    const file = await File.read(path);

    expect(file.category).toBe('video');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBeUndefined();
  });

  it('returns description when video exceeds maxMediaSizeBytes', async () => {
    const path = await write('huge.webm', magicBuf(0x1a, 0x45, 0xdf, 0xa3));
    const file = await File.read(path, { limits: { maxMediaSizeBytes: 2 } });

    expect(file.content).toBeUndefined();
    expect(file.description).toContain('media read limit');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File.read — audio
// ─────────────────────────────────────────────────────────────────────────────

describe('File.read — audio files', () => {
  it('detects MP3 by sync word 0xFF 0xFB', async () => {
    const path = await write('song1.mp3', magicBuf(0xff, 0xfb));
    const file = await File.read(path);

    expect(file.category).toBe('audio');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBe('mp3');
  });

  it('detects MP3 by sync word 0xFF 0xF3', async () => {
    const path = await write('song2.mp3', magicBuf(0xff, 0xf3));
    const file = await File.read(path);

    expect(file.category).toBe('audio');
    expect(file.detectedExt).toBe('mp3');
  });

  it('detects MP3 by sync word 0xFF 0xF2', async () => {
    const path = await write('song3.mp3', magicBuf(0xff, 0xf2));
    const file = await File.read(path);

    expect(file.category).toBe('audio');
    expect(file.detectedExt).toBe('mp3');
  });

  it('detects MP3 by ID3 header (0x49 0x44 0x33)', async () => {
    const path = await write('tagged.mp3', magicBuf(0x49, 0x44, 0x33));
    const file = await File.read(path);

    expect(file.category).toBe('audio');
    expect(file.detectedExt).toBe('mp3');
  });

  it('detects OGG by magic bytes', async () => {
    const path = await write('track.ogg', magicBuf(0x4f, 0x67, 0x67, 0x53));
    const file = await File.read(path);

    expect(file.category).toBe('audio');
    expect(file.detectedExt).toBe('ogg');
  });

  it('detects FLAC by magic bytes', async () => {
    const path = await write('lossless.flac', magicBuf(0x66, 0x4c, 0x61, 0x43));
    const file = await File.read(path);

    expect(file.category).toBe('audio');
    expect(file.detectedExt).toBe('flac');
  });

  it('detects WAV via RIFF sub-type', async () => {
    const path = await write('sound.wav', riffBuf('WAVE'));
    const file = await File.read(path);

    expect(file.category).toBe('audio');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBe('wav');
  });

  it('falls back to extension for audio', async () => {
    const path = await write('nomagic.aac', Buffer.from([0x01, 0x02, 0x03]));
    const file = await File.read(path);

    expect(file.category).toBe('audio');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBeUndefined();
  });

  it('returns description when audio exceeds maxMediaSizeBytes', async () => {
    const path = await write('huge.ogg', magicBuf(0x4f, 0x67, 0x67, 0x53));
    const file = await File.read(path, { limits: { maxMediaSizeBytes: 1 } });

    expect(file.content).toBeUndefined();
    expect(file.description).toContain('media read limit');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File.read — archives  (description-only, no content)
// ─────────────────────────────────────────────────────────────────────────────

describe('File.read — archive files', () => {
  const cases: [string, string, number[]][] = [
    ['ZIP (PK\\x03\\x04)',  'bundle.zip',   [0x50, 0x4b, 0x03, 0x04]],
    ['ZIP (PK\\x05\\x06)',  'empty.zip',    [0x50, 0x4b, 0x05, 0x06]],
    ['GZ',                  'data.tar.gz',  [0x1f, 0x8b]],
    ['BZ2',                 'data.bz2',     [0x42, 0x5a, 0x68]],
    ['7Z',                  'archive.7z',   [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
    ['RAR',                 'files.rar',    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]],
    ['XZ',                  'data.xz',      [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]],
  ];

  for (const [label, name, bytes] of cases) {
    it(`detects ${label} by magic bytes → description only`, async () => {
      const path = await write(name, magicBuf(...bytes));
      const file = await File.read(path);

      expect(file.category).toBe('archive');
      expect(file.content).toBeUndefined();
      expect(file.description).toBeDefined();
    });
  }

  it('falls back to extension for archive', async () => {
    const path = await write('nomagic.zip', Buffer.from([0x01, 0x02]));
    const file = await File.read(path);

    expect(file.category).toBe('archive');
    expect(file.content).toBeUndefined();
  });

  it('description contains "Compressed archive" note', async () => {
    const path = await write('assets.zip', magicBuf(0x50, 0x4b, 0x03, 0x04));
    const file = await File.read(path);

    expect(file.description).toContain('Compressed archive');
  });

  it('description contains file name, category, and format', async () => {
    const path = await write('report.zip', magicBuf(0x50, 0x4b, 0x03, 0x04));
    const file = await File.read(path);

    expect(file.description).toContain('"report.zip"');
    expect(file.description).toContain('category: archive');
    expect(file.description).toContain('format: zip');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File.read — documents
// ─────────────────────────────────────────────────────────────────────────────

describe('File.read — document files', () => {
  it('detects PDF by magic bytes → base64 content', async () => {
    const path = await write('report.pdf', magicBuf(0x25, 0x50, 0x44, 0x46));
    const file = await File.read(path);

    expect(file.category).toBe('document');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBe('pdf');
    expect(file.description).toBeUndefined();
  });

  it('detects DOC (OLE compound) by magic bytes', async () => {
    const path = await write('letter.doc', magicBuf(0xd0, 0xcf, 0x11, 0xe0));
    const file = await File.read(path);

    expect(file.category).toBe('document');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBe('doc');
  });

  it('falls back to extension for document', async () => {
    const path = await write('nomagic.xlsx', Buffer.from([0x01, 0x02, 0x03]));
    const file = await File.read(path);

    expect(file.category).toBe('document');
    expect(file.content?.encoding).toBe('base64');
    expect(file.detectedExt).toBeUndefined();
  });

  it('returns description when document exceeds maxDocumentSizeBytes', async () => {
    const path = await write('huge.pdf', magicBuf(0x25, 0x50, 0x44, 0x46));
    const file = await File.read(path, { limits: { maxDocumentSizeBytes: 4 } });

    expect(file.content).toBeUndefined();
    expect(file.description).toContain('"huge.pdf"');
    expect(file.description).toContain('document read limit');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File.read — binaries  (description-only, no content)
// ─────────────────────────────────────────────────────────────────────────────

describe('File.read — binary files', () => {
  const cases: [string, string, number[], string][] = [
    ['ELF',          'daemon',      [0x7f, 0x45, 0x4c, 0x46],                   'elf'],
    ['EXE (MZ)',     'app.exe',     [0x4d, 0x5a],                               'exe'],
    ['WASM',         'module.wasm', [0x00, 0x61, 0x73, 0x6d],                   'wasm'],
    ['Mach-O 32-bit','macho32',     [0xce, 0xfa, 0xed, 0xfe],                   'macho'],
    ['Mach-O 64-bit','macho64',     [0xcf, 0xfa, 0xed, 0xfe],                   'macho'],
    ['Java .class',  'Main.class',  [0xca, 0xfe, 0xba, 0xbe],                   'class'],
  ];

  for (const [label, name, bytes, expectedExt] of cases) {
    it(`detects ${label} by magic bytes → description only`, async () => {
      const path = await write(name, magicBuf(...bytes));
      const file = await File.read(path);

      expect(file.category).toBe('binary');
      expect(file.content).toBeUndefined();
      expect(file.description).toBeDefined();
      expect(file.detectedExt).toBe(expectedExt);
    });
  }

  it('falls back to extension for binary (.exe)', async () => {
    const path = await write('nomagic.exe', Buffer.from([0x01, 0x02, 0x03]));
    const file = await File.read(path);

    expect(file.category).toBe('binary');
    expect(file.content).toBeUndefined();
    expect(file.detectedExt).toBeUndefined();
  });

  it('description contains "Binary or specialized file" note', async () => {
    const path = await write('program', magicBuf(0x7f, 0x45, 0x4c, 0x46));
    const file = await File.read(path);

    expect(file.description).toContain('Binary or specialized file');
  });

  it('description contains file name, category and size', async () => {
    const path = await write('tool', magicBuf(0x7f, 0x45, 0x4c, 0x46));
    const file = await File.read(path);

    expect(file.description).toContain('"tool"');
    expect(file.description).toContain('category: binary');
    expect(file.description).toMatch(/\d+(\.\d+)?(B|KB|MB|GB)/);
  });

  it('description contains "detected:" when detected ext differs from file ext', async () => {
    // ELF bytes inside a .dat file
    const path = await write('mismatch.dat', magicBuf(0x7f, 0x45, 0x4c, 0x46));
    const file = await File.read(path);

    expect(file.ext).toBe('dat');
    expect(file.detectedExt).toBe('elf');
    expect(file.description).toContain('detected: elf');
  });

  it('binary-via-heuristic: unknown extension + null bytes → binary', async () => {
    const buf = Buffer.concat([
      Buffer.from([0x41, 0x42, 0x43]),  // printable ASCII
      Buffer.from([0x00]),               // null byte → triggers binary heuristic
      Buffer.from([0x44, 0x45, 0x46]),
    ]);
    const path = await write('data.xyz', buf);
    const file = await File.read(path);

    expect(file.category).toBe('binary');
    expect(file.content).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File.read — description / formatSize
// ─────────────────────────────────────────────────────────────────────────────

describe('File.read — description formatting and formatSize', () => {
  it('formats bytes as "NB" for files < 1 KB', async () => {
    const content = 'hi';  // 2 bytes
    const path = await write('tiny.ts', content);
    const file = await File.read(path, { limits: { maxTextSizeBytes: 1 } });

    expect(file.description).toContain('2B');
  });

  it('formats size as "N.NKB" for kilobyte-range files', async () => {
    const content = 'x'.repeat(1500);
    const path = await write('medium.ts', content);
    const file = await File.read(path, { limits: { maxTextSizeBytes: 100 } });

    expect(file.description).toContain('KB');
  });

  it('formats "N.NMB" for megabyte-range files (custom limits)', async () => {
    // Create a 2 MB (approx) buffer of printable text, then force the limit below it
    const content = 'a'.repeat(2 * 1024 * 1024);
    const path = await write('large.ts', content);
    const file = await File.read(path, { limits: { maxTextSizeBytes: 1024 * 1024 } });

    expect(file.description).toContain('MB');
  });

  it('archive description format: name, category, format, size, note', async () => {
    const path = await write('payload.zip', magicBuf(0x50, 0x4b, 0x03, 0x04));
    const file = await File.read(path);

    expect(file.description).toMatch(/File "payload\.zip" — category: archive, format: zip, size: \d+(\.\d+)?B/);
    expect(file.description).toContain('Compressed archive');
  });

  it('hard-cap description mentions both actual size and limit', async () => {
    const content = '1234567890';  // 10 bytes
    const path = await write('cap.txt', content);
    const file = await File.read(path, { limits: { maxFileSizeBytes: 5 } });

    expect(file.description).toContain('10B');
    expect(file.description).toContain('5B');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File.read — RIFF container (all three sub-types in one block)
// ─────────────────────────────────────────────────────────────────────────────

describe('File.read — RIFF container detection', () => {
  it('RIFF/WAVE → audio/wav', async () => {
    const path = await write('chime.wav', riffBuf('WAVE'));
    const file = await File.read(path);
    expect(file.category).toBe('audio');
    expect(file.detectedExt).toBe('wav');
    expect(file.content?.encoding).toBe('base64');
  });

  it('RIFF/AVI_ → video/avi', async () => {
    const path = await write('screen.avi', riffBuf('AVI '));
    const file = await File.read(path);
    expect(file.category).toBe('video');
    expect(file.detectedExt).toBe('avi');
    expect(file.content?.encoding).toBe('base64');
  });

  it('RIFF/WEBP → image/webp', async () => {
    const path = await write('logo.webp', riffBuf('WEBP'));
    const file = await File.read(path);
    expect(file.category).toBe('image');
    expect(file.detectedExt).toBe('webp');
    expect(file.content?.encoding).toBe('base64');
  });

  it('RIFF with unknown sub-type falls through to MAGIC loop', async () => {
    // 'RIFF' + size + 'UNKN' — should not match any MAGIC entry either,
    // category falls back to extension. The RIFF buffer contains null bytes
    // (LE size field), so looksLikeText() returns false → binary.
    const path = await write('mystery.xyz', riffBuf('UNKN'));
    const file = await File.read(path);
    expect(file.category).toBe('binary');
  });
});
