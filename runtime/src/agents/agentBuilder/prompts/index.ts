import path from 'path';
import { readFile } from 'fs/promises';
import { replaceVars } from '../../../utils/readReplace.js';
const cwd = process.cwd();

const systemPromptPath = path.join(cwd, 'src/agents/agentBuilder/prompts/SYSTEM_PROMPT.MD');

const systemPromptTemplate = await readFile(systemPromptPath, 'utf-8');

export interface SystemPromptVars {
  builtinTools: string;
  toolkits: string;
}

export function createSystemPrompt(vars: SystemPromptVars): string {
  return replaceVars(systemPromptTemplate, vars);
}
