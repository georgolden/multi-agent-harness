import { type Static, Type } from '@sinclair/typebox';
import type { AgentTool } from '../types.js';
import { ToolResultMessage } from '../utils/message.js';
import { ToolCallContext } from './index.js';
import { App } from '../app.js';

const skillSchema = Type.Object({
  name: Type.String({ description: 'The name of the skill to activate' }),
});

export type SkillToolInput = Static<typeof skillSchema>;

export type SkillToolError = { error: string };
export type SkillToolSuccess = {
  skill: string;
  base_dir: string;
  instructions: string;
  files: string[];
  sandbox: { sandboxed_tools: string[] } | null;
};

const errResult = (toolCallId: string, message: string) => {
  const body: SkillToolError = { error: message };
  return {
    data: new ToolResultMessage({ toolCallId, content: JSON.stringify(body) }),
    details: undefined,
    error: new Error(message),
  };
};

export function createSkillTool(): AgentTool<typeof skillSchema> {
  return {
    name: 'skill',
    label: 'skill',
    description:
      'Activate a skill by name. Loads its SKILL.md into the system prompt and (if the skill has a runtime) registers sandboxed tools scoped to that skill workspace.',
    parameters: skillSchema,
    execute: async ({ skills, services }: App, { session }: ToolCallContext, { name }, { toolCallId }) => {
      const skill = skills.getSkill(name);

      if (!skill) {
        const available = skills.getSkills().map((s) => s.name);
        return errResult(toolCallId, `Skill '${name}' not found. Available: ${available.join(', ')}`);
      }

      if (session.getEnabledSkill(name)) {
        return errResult(toolCallId, `Skill '${name}' is already active`);
      }

      const md = await skill.readSkillMd();
      const files = await skill.readContent();
      const fileCap = files.slice(0, 10);

      await session.activateSkill(name, skill, md);

      const result: SkillToolSuccess = {
        skill: name,
        base_dir: skill.location,
        instructions: md,
        files: fileCap.map((f) => f.path),
        sandbox: null,
      };

      if (skill.runtime) {
        const { sandboxToolNames, error } = await session.ensureSkillSandbox(name, services.sandbox);
        if (error) {
          return errResult(toolCallId, `Sandbox failed for skill '${name}': ${error.message}`);
        }
        result.sandbox = { sandboxed_tools: sandboxToolNames ?? [] };
      }

      return {
        data: new ToolResultMessage({ toolCallId, content: JSON.stringify(result) }),
        details: undefined,
      };
    },
  };
}
