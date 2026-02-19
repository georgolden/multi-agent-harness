import { Flow } from 'pocketflow';
import { PrepareInput, DecideAction, AskUser, ToolCalls } from './nodes.js';
import type { SharedStore } from '../../types.js';
import type { TimezoneContext } from './types.js';

export type TimezoneFlow = Flow<SharedStore<TimezoneContext>>;

export function createTimezoneFlow(): Flow<SharedStore<TimezoneContext>> {
  const prepareInput = new PrepareInput();
  const decideAction = new DecideAction();
  const askUser = new AskUser();
  const toolCalls = new ToolCalls();

  prepareInput.next(decideAction);
  decideAction.on('ask_user', askUser);
  decideAction.on('tool_calls', toolCalls);
  toolCalls.next(decideAction);

  return new Flow<SharedStore<TimezoneContext>>(prepareInput);
}
