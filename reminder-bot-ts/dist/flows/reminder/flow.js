/**
 * PocketFlow flow for the reminder agent.
 * Connects all nodes in a clear, directed graph.
 */
import { Flow } from 'pocketflow';
import { PrepareInput, DecideAction, AskUser, ToolCalls } from './nodes.js';
/**
 * Create and return the reminder agent flow
 */
export function createReminderFlow() {
    // Create nodes
    const prepareInput = new PrepareInput();
    const decideAction = new DecideAction();
    const askUser = new AskUser();
    const toolCalls = new ToolCalls();
    // PrepareInput runs once, then goes to DecideAction
    prepareInput.next(decideAction);
    // DecideAction routes to different actions
    decideAction.on('ask_user', askUser);
    decideAction.on('tool_calls', toolCalls);
    // AskUser ends the flow (response is the question)
    // ToolCalls loops back to DecideAction
    toolCalls.next(decideAction);
    // Create flow starting with PrepareInput
    return new Flow(prepareInput);
}
