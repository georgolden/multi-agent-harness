import path from 'path';
import { readFile } from 'fs/promises';
import { replaceVars } from '../../../utils/readReplace.js';
const cwd = process.cwd();
// Load the system prompt template and skill file asynchronously.
const systemPromptTemplatePath = path.join(cwd, 'src/flows/reminder/prompts/SYSTEM_PROMPT.MD');
const skillPath = path.join(cwd, 'src/skills/schedule/SKILL.md');
const [systemPromptTemplate, scheduleSkill] = await Promise.all([
    readFile(systemPromptTemplatePath, 'utf-8'),
    readFile(skillPath, 'utf-8'),
]);
export function createSystemPrompt(currentISODatetime, userTimezone, reminders) {
    const variables = {
        currentISODatetime,
        userTimezone,
        reminders,
        SCHEDULE_SKILL: scheduleSkill,
    };
    return replaceVars(systemPromptTemplate, variables);
}
