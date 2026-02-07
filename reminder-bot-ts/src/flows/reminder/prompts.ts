import { fileURLToPath } from 'url';
import path from 'path';
import { readFile } from 'fs/promises';
import { replaceVars } from '../../utils/readReplace.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the system prompt template and skill file asynchronously.
const systemPromptTemplatePath = path.join(__dirname, 'SYSTEM_PROMPT.MD');
const skillPath = path.join(__dirname, '../../skills/schedule/SKILL.md');

const [systemPromptTemplate, scheduleSkill] = await Promise.all([
  readFile(systemPromptTemplatePath, 'utf-8'),
  readFile(skillPath, 'utf-8'),
]);

export function createSystemPrompt(currentISODatetime: string, userTimezone: string, reminders: string): string {
  const variables = {
    currentISODatetime,
    userTimezone,
    reminders,
    SCHEDULE_SKILL: scheduleSkill,
  };
  return replaceVars(systemPromptTemplate, variables);
}
