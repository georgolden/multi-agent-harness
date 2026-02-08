import { App } from './app.js';
export type SharedStore<Context = Record<string, any>> = {
    app: App;
    context: Context;
};
export type { ChatCompletion, ChatCompletionMessage, ChatCompletionMessageParam, ChatCompletionMessageToolCall, ChatCompletionMessageFunctionToolCall, } from 'openai/resources';
