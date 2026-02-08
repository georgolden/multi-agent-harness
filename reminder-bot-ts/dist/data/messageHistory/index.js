/**
 * storing and managing conversation histories
 */
export class MessageHistory {
    maxMessages;
    conversations;
    app;
    constructor(app, { maxMessages }) {
        this.app = app;
        this.maxMessages = maxMessages;
        this.conversations = new Map();
    }
    /**
     * Initialize the message history service
     */
    async start() {
        console.log('[MessageHistory] Service started');
    }
    /**
     * Stop the service and clear all conversation history
     */
    async stop() {
        this.conversations.clear();
        console.log('[MessageHistory] Service stopped, conversations cleared');
    }
    /**
     * Trim conversation to keep only recent messages
     */
    trimConversation(conv) {
        if (conv.length <= this.maxMessages) {
            return conv;
        }
        return conv.slice(-this.maxMessages);
    }
    /**
     * Add a message to a user's conversation history
     */
    addMessage(userId, message) {
        const history = this.conversations.get(userId) || [];
        history.push(message);
        this.conversations.set(userId, this.trimConversation(history));
    }
    addMessages(userId, messages) {
        const history = this.conversations.get(userId) || [];
        history.push(...messages);
        this.conversations.set(userId, this.trimConversation(history));
    }
    /**
     * Get conversation history for a user
     */
    getConversation(userId) {
        return this.conversations.get(userId) || [];
    }
    /**
     * Clear conversation history for a specific user
     */
    clearConversation(userId) {
        this.conversations.delete(userId);
    }
}
export const config = {
    maxMessages: 20,
};
