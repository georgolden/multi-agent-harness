import type { App } from '../../app.js';
export declare class TelegramService {
    private bot;
    private app;
    constructor(app: App, { token }: {
        token: string;
    });
    /**
     * Start the Telegram bot service
     */
    start(): Promise<void>;
    /**
     * Stop the Telegram bot service
     */
    stop(): Promise<void>;
    /**
     * Send a message to a user/chat
     */
    sendMessage(chatId: string, message: string): Promise<void>;
    /**
     * Handle incoming messages
     */
    private handleMessage;
    private startCommand;
    private helpCommand;
}
export declare const config: {
    token: string;
};
