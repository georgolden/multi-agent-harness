/**
 * Nodes for the agentBuilder flow.
 *
 * Flow graph:
 *   PrepareInput → DecideAction ─┬─ write_temp_file → WriteTempFile → PrepareInput (loop)
 *                                ├─ ask_user        → AskUser        (pause)
 *                                │                    AskUser → UserResponse → PrepareInput
 *                                └─ submit_result   → SubmitAnswer   (exit)
 *
 * PrepareInput owns:
 *   1. Upsert system prompt (regenerated each entry — picks up new toolkits live)
 *   2. Add user message only on first entry (p.data has a `message` string)
 *      On loop-back (from WriteTempFile or UserResponse) p.data is undefined — skip.
 */
import { Node, packet, exit, pause } from '../../utils/agent/flow.js';
import { callLlmWithTools, callLlmWithToolsStream } from '../../utils/callLlm.js';
import { TOOLS } from './tools.js';
import { AssistantMessage, ToolResultMessage, UserMessage } from '../../utils/message.js';
import type { AgentBuilderContext } from './types.js';
import type { App } from '../../app.js';
import type { AgenticLoopSchema } from '../agentictLoop/flow.js';
import type { LLMToolCall } from '../../utils/message.js';
import { createSystemPrompt } from './prompts/index.js';

// ─── PrepareInput ────────────────────────────────────────────────────────────

export class PrepareInput extends Node<App, AgentBuilderContext, { message: string } | undefined, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;

    // Regenerate and upsert system prompt — runs on every entry including loop-backs,
    // so newly connected toolkits are immediately visible to the LLM.
    const builtinTools = p.deps.tools.getBuiltinToolDescriptions();
    const userToolkits = await user.getToolkits();
    const toolkits =
      userToolkits.length > 0
        ? userToolkits.map((t) => `- ${t.toolkitSlug} (${t.name}): ${t.description}`).join('\n')
        : '(none connected)';

    const availableSkills = p.deps.skills.getSkills();
    const skills =
      availableSkills.length > 0
        ? availableSkills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
        : '(none available)';

    const systemPrompt = createSystemPrompt({ builtinTools, toolkits, skills });
    await session.upsertSystemPrompt(systemPrompt);

    // First entry: p.data is { message: string } — add it as the user message.
    // Loop-back entries: p.data is undefined — nothing to add.
    const input = p.data;
    if (input?.message) {
      await session.addUserMessage(new UserMessage(input.message));
    }

    console.log(`[agentBuilder.PrepareInput] session='${session.id}' firstEntry=${!!input?.message}`);
    return packet({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── DecideAction ─────────────────────────────────────────────────────────────

export class DecideAction extends Node<
  App,
  AgentBuilderContext,
  void,
  {
    write_temp_file: LLMToolCall[];
    get_toolkit_tools: LLMToolCall;
    get_toolkit_tool_schemas: LLMToolCall;
    ask_user: string;
    submit_result: LLMToolCall;
  }
> {
  constructor() {
    super({ maxRunTries: 3, wait: 1000 });
  }

  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const messages = session.activeMessages.map((msg) => msg.message);

    console.log(`[agentBuilder.DecideAction] session='${session.id}' messages=${messages.length}`);

    const { stream, finalResult } = callLlmWithToolsStream(messages, TOOLS);
    await session.streamToBus(stream);
    const response = await finalResult;
    const assistantMsg = AssistantMessage.from(response[0].message);
    await session.addMessages([{ message: assistantMsg.toJSON() }]);

    if ('toolCalls' in assistantMsg && assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
      const toolCalls = assistantMsg.toolCalls;
      const submitCall = toolCalls.find((tc) => tc.name === 'submit_result');
      const writeCalls = toolCalls.filter((tc) => tc.name === 'write_temp_file');
      const getToolsCall = toolCalls.find((tc) => tc.name === 'get_toolkit_tools');
      const getSchemasCall = toolCalls.find((tc) => tc.name === 'get_toolkit_tool_schemas');

      if (submitCall) {
        return packet({ data: submitCall, context: p.context, branch: 'submit_result', deps: p.deps });
      }
      if (writeCalls.length > 0) {
        return packet({ data: writeCalls, context: p.context, branch: 'write_temp_file', deps: p.deps });
      }
      if (getToolsCall) {
        return packet({ data: getToolsCall, context: p.context, branch: 'get_toolkit_tools', deps: p.deps });
      }
      if (getSchemasCall) {
        return packet({ data: getSchemasCall, context: p.context, branch: 'get_toolkit_tool_schemas', deps: p.deps });
      }
    }

    const text = (assistantMsg.toJSON().content || '').trim();
    if (!text) {
      // Empty turn (no tool calls, no content — usually reasoning-only). Throwing
      // here triggers the node's maxRunTries retry; if it keeps coming back empty
      // we fall through with an explicit nudge so the user isn't stuck on silent
      // pause/resume loops.
      console.warn(`[agentBuilder.DecideAction] empty assistant turn — retrying`);
      throw new Error('Empty assistant turn (no text and no tool calls)');
    }
    return packet({ data: text, context: p.context, branch: 'ask_user', deps: p.deps });
  }
}

// ─── WriteTempFile ─────────────────────────────────────────────────────────────

export class WriteTempFile extends Node<App, AgentBuilderContext, LLMToolCall[], { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    const toolCalls = p.data;

    const results: { message: ReturnType<ToolResultMessage['toJSON']> }[] = [];
    for (const toolCall of toolCalls) {
      const { name, content } = toolCall.args as { name: string; content: string };
      console.log(`[agentBuilder.WriteTempFile] writing '${name}' (${content.length} chars) session='${session.id}'`);
      await session.writeTempFile({ name, content });
      results.push({
        message: new ToolResultMessage({
          toolCallId: toolCall.id,
          content: JSON.stringify({ success: true, name, contentLength: content.length }),
        }).toJSON(),
      });
    }

    await session.addMessages(results);
    return packet({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── GetToolkitTools ──────────────────────────────────────────────────────────

export class GetToolkitTools extends Node<App, AgentBuilderContext, LLMToolCall, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    const toolCall = p.data;
    const { toolkit_slugs } = toolCall.args as { toolkit_slugs: string[] };

    console.log(`[agentBuilder.GetToolkitTools] slugs=${JSON.stringify(toolkit_slugs)} session='${session.id}'`);

    const userToolkits = await user.getToolkits();
    type ToolBrief = { slug: string; name: string; description: string };
    const results: Record<string, { error?: string; tools?: ToolBrief[] }> = {};
    for (const slug of toolkit_slugs) {
      const toolkit = userToolkits.find((t) => t.toolkitSlug === slug);
      if (!toolkit) {
        results[slug] = { error: `Toolkit '${slug}' is not connected for this user.` };
        continue;
      }
      const provider = p.deps.services.toolProviderRegistry.get(toolkit.provider);
      const providerData = toolkit.providerData as { externalUserId: string; authConfigId: string };
      const schemas = await provider.getToolSchemas({
        externalUserId: providerData.externalUserId,
        authConfigId: providerData.authConfigId,
        limit: 100,
      });
      results[slug] = {
        tools: schemas.map((s) => ({ slug: s.slug, name: s.name, description: s.description })),
      };
    }

    await session.addMessages([
      {
        message: new ToolResultMessage({
          toolCallId: toolCall.id,
          content: JSON.stringify(results),
        }).toJSON(),
      },
    ]);

    return packet({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── GetToolkitToolSchemas ────────────────────────────────────────────────────

export class GetToolkitToolSchemas extends Node<App, AgentBuilderContext, LLMToolCall, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    const toolCall = p.data;
    const { toolkit_slug, tool_slugs } = toolCall.args as { toolkit_slug: string; tool_slugs: string[] };

    console.log(`[agentBuilder.GetToolkitToolSchemas] toolkit='${toolkit_slug}' tools=${JSON.stringify(tool_slugs)} session='${session.id}'`);

    const userToolkits = await user.getToolkits();
    const toolkit = userToolkits.find((t) => t.toolkitSlug === toolkit_slug);
    if (!toolkit) {
      await session.addToolError(toolCall.id, `Toolkit '${toolkit_slug}' is not connected for this user.`);
      return packet({ data: undefined, context: p.context, deps: p.deps });
    }

    const provider = p.deps.services.toolProviderRegistry.get(toolkit.provider);
    const providerData = toolkit.providerData as { externalUserId: string; authConfigId: string };
    const schemas = await provider.getToolSchemas({
      externalUserId: providerData.externalUserId,
      authConfigId: providerData.authConfigId,
      toolSlugs: tool_slugs,
    });

    type SchemaOut = {
      slug: string;
      name: string;
      description: string;
      inputParameters: Record<string, unknown>;
      outputParameters: Record<string, unknown>;
    };
    const found: SchemaOut[] = schemas.map((s) => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
      inputParameters: s.inputParameters,
      outputParameters: s.outputParameters,
    }));
    const foundSlugs = new Set(found.map((s) => s.slug));
    const missing = tool_slugs.filter((s) => !foundSlugs.has(s));

    await session.addMessages([
      {
        message: new ToolResultMessage({
          toolCallId: toolCall.id,
          content: JSON.stringify({ tools: found, missing }),
        }).toJSON(),
      },
    ]);

    return packet({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── AskUser ──────────────────────────────────────────────────────────────────

export class AskUser extends Node<App, AgentBuilderContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    console.log(`[agentBuilder.AskUser] session='${session.id}'`);
    session.notify(user, p.data);
    session.onUserMessage(({ message }: { message: string }) => {
      this.resume({ data: message, context: p.context, deps: p.deps });
    });
    await session.pause();
    return pause({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── UserResponse ─────────────────────────────────────────────────────────────

export class UserResponse extends Node<App, AgentBuilderContext, string, { default: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const session = p.context.session;
    await session.addUserMessage(new UserMessage(p.data));
    await session.resume();
    return packet({ data: undefined, context: p.context, deps: p.deps });
  }
}

// ─── SubmitAnswer ─────────────────────────────────────────────────────────────

export class SubmitAnswer extends Node<App, AgentBuilderContext, LLMToolCall, { default: void; error: void }> {
  async run(p: this['In']): Promise<this['Out']> {
    const { session, user } = p.context;
    const app = p.deps;
    const toolCall = p.data;
    const schemaRaw = toolCall.args.answer as string;

    await session.writeTempFile({ name: 'agent_schema.json', content: schemaRaw });

    let parsed: AgenticLoopSchema;
    try {
      parsed = JSON.parse(schemaRaw) as AgenticLoopSchema;
    } catch (e) {
      const msg = `Invalid JSON in schema: ${e}`;
      console.error(`[agentBuilder.SubmitAnswer] ${msg}`);
      await session.addToolError(toolCall.id, msg);
      return packet({ data: undefined, branch: 'error', context: p.context, deps: p.deps });
    }

    try {
      await app.data.agenticLoopSchemaRepository.createSchema({ userId: user.id, schema: parsed });
      console.log(`[agentBuilder.SubmitAnswer] schema '${parsed.name}' saved`);
    } catch (e) {
      const msg = `Failed to save schema: ${e}`;
      console.error(`[agentBuilder.SubmitAnswer] ${msg}`);
      await session.addToolError(toolCall.id, msg);
      return packet({ data: undefined, branch: 'error', context: p.context, deps: p.deps });
    }

    await session.complete();
    return exit({ data: undefined, context: p.context, deps: p.deps });
  }
}
