import path from 'path';
import { readFile } from 'fs/promises';

const cwd = process.cwd();

const systemPromptPath = path.join(cwd, 'src/agents/agentBuilder/prompts/SYSTEM_PROMPT.MD');

const systemPromptContent = await readFile(systemPromptPath, 'utf-8');

export function createSystemPrompt(): string {
  return systemPromptContent;
}
