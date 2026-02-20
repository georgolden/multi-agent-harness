import path from 'path';
import { readFile, stat } from 'fs/promises';
import { ContextFile, ContextFolderInfo } from '../../data/flowSessionRepository/types.js';
import { User } from '../../data/userRepository/types.js';
import { replaceVars } from '../../utils/readReplace.js';
import { runTreeCommand } from '../../tools/tree.js';

export function fillSystemPrompt(systemPrompt: string, user: User): string {
  return replaceVars(systemPrompt, {
    userTimezone: user.timezone,
    currentDate: new Date().toISOString(),
  });
}

const MAX_TEXT_LINES = 4000;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // 100 MB

const MEDIA_EXTENSIONS = new Set([
  // Images
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.svg',
  '.webp',
  '.ico',
  '.tiff',
  '.tif',
  // Audio
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.opus',
  // Video
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.wmv',
  '.webm',
  '.flv',
  '.m4v',
]);

export async function readFilesWithLimit(filePaths: string[]): Promise<ContextFile[]> {
  const results = await Promise.all(
    filePaths.map(async (filePath): Promise<ContextFile | null> => {
      try {
        const ext = path.extname(filePath).toLowerCase();
        if (MEDIA_EXTENSIONS.has(ext)) {
          const info = await stat(filePath);
          if (info.size > MAX_MEDIA_BYTES) {
            console.warn(`Skipping media file over 100 MB: ${filePath}`);
            return null;
          }
          const buffer = await readFile(filePath);
          return { path: filePath, content: buffer.toString('base64') };
        } else {
          const content = await readFile(filePath, 'utf-8');
          const lines = content.split('\n');
          const truncated = lines.length > MAX_TEXT_LINES ? lines.slice(0, MAX_TEXT_LINES).join('\n') : content;
          return { path: filePath, content: truncated };
        }
      } catch (error) {
        console.warn(`Failed to read file ${filePath}:`, error);
        return null;
      }
    }),
  );
  return results.filter((f): f is ContextFile => f !== null);
}

export async function readFoldersInfos(folderPaths: string[]): Promise<ContextFolderInfo[]> {
  const results = await Promise.all(
    folderPaths.map(async (folderPath): Promise<ContextFolderInfo | null> => {
      try {
        const tree = await runTreeCommand(folderPath);
        return { path: folderPath, tree };
      } catch (error) {
        console.warn(`Failed to read folder ${folderPath}:`, error);
        return null;
      }
    }),
  );
  return results.filter((f): f is ContextFolderInfo => f !== null);
}
