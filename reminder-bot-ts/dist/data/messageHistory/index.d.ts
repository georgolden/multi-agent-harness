/**
 * Message history service for managing conversation state per user
 */
import type { ChatCompletionMessage, ChatCompletionMessageParam } from '../../types.js';
import { App } from '../../app.js';
export type ConversationMessage = ChatCompletionMessage | ChatCompletionMessageParam;
/**
 * storing and managing conversation histories
 */
export declare class MessageHistory {
    private maxMessages;
    conversations: Map<string, ConversationMessage[]>;
    app: App;
    constructor(app: App, { maxMessages }: {
        maxMessages: number;
    });
    /**
     * Initialize the message history service
     */
    start(): Promise<void>;
    /**
     * Stop the service and clear all conversation history
     */
    stop(): Promise<void>;
    /**
     * Trim conversation to keep only recent messages
     */
    trimConversation(conv: ConversationMessage[]): ConversationMessage[];
    /**
     * Add a message to a user's conversation history
     */
    addMessage(userId: string, message: ConversationMessage): void;
    addMessages(userId: string, messages: ConversationMessage[]): void;
    /**
     * Get conversation history for a user
     */
    getConversation(userId: string): ConversationMessage[];
    /**
     * Clear conversation history for a specific user
     */
    clearConversation(userId: string): void;
}
export declare const config: {
    maxMessages: number;
};
