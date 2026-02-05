/**
 * Message history service for managing conversation state per user
 */
import type { ChatCompletionMessage, ChatCompletionMessageParam } from '../types.js';
import { App } from '../app.js';

export type ConversationMessage = ChatCompletionMessage | ChatCompletionMessageParam;

/**
 * storing and managing conversation histories
 */
export class MessageHistory {
  private maxMessages: number;
  public conversations: Map<string, ConversationMessage[]>;
  app: App;

  constructor(app: App, { maxMessages }: { maxMessages: number }) {
    this.app = app;
    this.maxMessages = maxMessages;
    this.conversations = new Map<string, ConversationMessage[]>();
  }

  /**
   * Initialize the message history service
   */
  async start(): Promise<void> {
    console.log('[MessageHistory] Service started');
  }

  /**
   * Stop the service and clear all conversation history
   */
  async stop(): Promise<void> {
    this.conversations.clear();
    console.log('[MessageHistory] Service stopped, conversations cleared');
  }

  /**
   * Trim conversation to keep only recent messages
   */
  trimConversation(conv: ConversationMessage[]): ConversationMessage[] {
    if (conv.length <= this.maxMessages) {
      return conv;
    }
    return conv.slice(-this.maxMessages);
  }

  /**
   * Add a message to a user's conversation history
   */
  addMessage(userId: string, message: ConversationMessage): void {
    const history = this.conversations.get(userId) || [];
    history.push(message);
    this.conversations.set(userId, this.trimConversation(history));
  }

  addMessages(userId: string, messages: ConversationMessage[]): void {
    const history = this.conversations.get(userId) || [];
    history.push(...messages);
    this.conversations.set(userId, this.trimConversation(history));
  }

  /**
   * Get conversation history for a user
   */
  getConversation(userId: string): ConversationMessage[] {
    return this.conversations.get(userId) || [];
  }

  /**
   * Clear conversation history for a specific user
   */
  clearConversation(userId: string): void {
    this.conversations.delete(userId);
  }
}
