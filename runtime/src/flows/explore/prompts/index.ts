import path from 'path';
import { readFile } from 'fs/promises';
import { replaceVars } from '../../../utils/readReplace.js';

const cwd = process.cwd();

// Load the system prompt template and skill file asynchronously.
const systemPromptTemplatePath = path.join(cwd, 'src/flows/explore/prompts/SYSTEM_PROMPT.MD');

const systemPromptTemplate = await readFile(systemPromptTemplatePath, 'utf-8');

export function createSystemPrompt(): string {
  return systemPromptTemplate;
}

export function wrapUserPrompt(userPrompt: string): string {
  return `
    User's query:
    \`\`\`
    ${userPrompt}
    \`\`\`
    Explore and find context that is relevant for user's query.
  `;
}
