import { type Static, Type } from '@sinclair/typebox';
import type { AgentTool } from '../types.js';
import { ToolResultMessage } from '../utils/message.js';
import type { Skills } from '../skills/index.js';
import type { SandboxService } from '../services/sandbox/index.js';
import type { Session } from '../services/sessionService/session.js';

const skillSchema = Type.Object({
  name: Type.String({ description: 'The name of the skill to activate' }),
});

export type SkillToolInput = Static<typeof skillSchema>;

export function createSkillTool(
  skills: Skills,
  sandbox: SandboxService,
  session: Session,
): AgentTool<typeof skillSchema> {
  return {
    name: 'skill',
    label: 'skill',
    description:
      'Activate a skill by name. Loads its SKILL.md into the system prompt and (if the skill has a runtime) switches bash/read/edit/write to sandboxed variants scoped to the skill workspace.',
    parameters: skillSchema,
    execute: async (_app, _context, { name }, { toolCallId }) => {
      const skill = skills.getSkill(name);
      if (!skill) {
        const available = skills.getSkills().map((s) => s.name).join(', ');
        return {
          data: new ToolResultMessage({ toolCallId, content: `Skill '${name}' not found. Available skills: ${available}` }),
          details: undefined,
          error: new Error(`Skill '${name}' not found`),
        };
      }

      if (session.getEnabledSkill(name)) {
        return {
          data: new ToolResultMessage({ toolCallId, content: `Skill '${name}' is already active on this session.` }),
          details: undefined,
        };
      }

      const md = await skill.readSkillMd();
      const files = await skill.readContent();
      const fileCap = files.slice(0, 10);
      const filesXml = fileCap.map((f) => `<file path="${f.path}" />`).join('\n');

      const newPrompt = `${session.systemPrompt}\n\n<skill name="${name}">\n${md}\n</skill>`;
      await session.upsertSystemPrompt(newPrompt);
      await session.enableSkill(name, { skill, sandboxSession: null });

      let sandboxNote = '';
      if (skill.runtime) {
        try {
          const execSession = await sandbox.createSkillSession({ session, skill });
          const sandboxedTools = sandbox.createSandboxedTools(execSession);
          session.addOrReplaceAgentTools([
            sandboxedTools.bash,
            sandboxedTools.read,
            sandboxedTools.edit,
            sandboxedTools.write,
          ]);
          session.updateEnabledSkillSandbox(name, execSession);
          sandboxNote = '\n\nbash, read, edit, and write now operate inside the skill sandbox.';
        } catch (err: any) {
          sandboxNote = `\n\nNote: sandbox could not be started (${err?.message ?? err}). Tools remain unsandboxed.`;
        }
      }

      const content = [
        `<skill_content name="${name}" base_dir="${skill.location}">`,
        md,
        fileCap.length > 0 ? `\n<files>\n${filesXml}\n</files>` : '',
        `</skill_content>`,
        sandboxNote,
      ].join('');

      return {
        data: new ToolResultMessage({ toolCallId, content }),
        details: undefined,
      };
    },
  };
}
