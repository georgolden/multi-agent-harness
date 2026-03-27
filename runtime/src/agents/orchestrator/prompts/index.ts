import path from 'path';
import { readFile } from 'fs/promises';
import { replaceVars } from '../../../utils/readReplace.js';

const cwd = process.cwd();

// Load the system prompt template and skill file asynchronously.
const systemPromptTemplatePath = path.join(cwd, 'src/agents/orchestrator/prompts/SYSTEM_PROMPT.MD');

const systemPromptTemplate = await readFile(systemPromptTemplatePath, 'utf-8');

export function createSystemPrompt(currentISODatetime: string, userTimezone: string, userName: string, agents: string): string {
  const variables = {
    currentISODatetime,
    userTimezone,
    userName,
    agents,
  };
  return replaceVars(systemPromptTemplate, variables);
}
