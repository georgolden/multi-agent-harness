import { Flow } from 'pocketflow';
import { PrepareInput, DecideAction, AskUser, ToolCalls } from './nodes.js';
export function createTimezoneFlow() {
    const prepareInput = new PrepareInput();
    const decideAction = new DecideAction();
    const askUser = new AskUser();
    const toolCalls = new ToolCalls();
    prepareInput.next(decideAction);
    decideAction.on('ask_user', askUser);
    decideAction.on('tool_calls', toolCalls);
    toolCalls.next(decideAction);
    return new Flow(prepareInput);
}
