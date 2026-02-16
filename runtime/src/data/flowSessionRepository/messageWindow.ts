/**
 * Message window functions - handles active message window computation
 * Implements smart windowing: keeps first N messages + sliding window of recent messages
 */
import type { FlowMessage, MessageWindowConfig } from './types.js';

/**
 * Compute the active message window based on configuration
 * Strategy:
 * 1. Always keep first N messages (typically system prompt + initial user task)
 * 2. Keep last M messages (sliding window)
 * 3. If messages fit in window, return all
 */
export function computeActiveWindow(messages: FlowMessage[], config: MessageWindowConfig): FlowMessage[] {
  const { keepFirstMessages, slidingWindowSize } = config;

  // If total messages fit in the window, return all
  const totalWindowSize = keepFirstMessages + slidingWindowSize;
  if (messages.length <= totalWindowSize) {
    return messages;
  }

  // Split into first messages and recent messages
  const firstMessages = messages.slice(0, keepFirstMessages);
  const recentMessages = messages.slice(-slidingWindowSize);

  // Check if there's overlap (when messages length is small)
  const firstLastIndex = keepFirstMessages - 1;
  const recentFirstIndex = messages.length - slidingWindowSize;

  if (firstLastIndex >= recentFirstIndex) {
    // Overlap detected, just return all messages
    return messages;
  }

  // Combine first messages and recent messages
  return [...firstMessages, ...recentMessages];
}

/**
 * Get messages that are outside the active window (archived messages)
 */
export function getArchivedMessages(messages: FlowMessage[], config: MessageWindowConfig): FlowMessage[] {
  const { keepFirstMessages, slidingWindowSize } = config;

  // If all messages fit in window, nothing is archived
  const totalWindowSize = keepFirstMessages + slidingWindowSize;
  if (messages.length <= totalWindowSize) {
    return [];
  }

  // Return messages between first messages and recent messages
  const startIndex = keepFirstMessages;
  const endIndex = messages.length - slidingWindowSize;

  if (startIndex >= endIndex) {
    return [];
  }

  return messages.slice(startIndex, endIndex);
}

/**
 * Get statistics about the message window
 */
export function getWindowStats(
  messages: FlowMessage[],
  config: MessageWindowConfig,
): {
  totalMessages: number;
  activeMessages: number;
  archivedMessages: number;
  firstMessagesCount: number;
  recentMessagesCount: number;
} {
  const { keepFirstMessages, slidingWindowSize } = config;
  const activeMessages = computeActiveWindow(messages, config);
  const archivedMessages = getArchivedMessages(messages, config);

  const totalWindowSize = keepFirstMessages + slidingWindowSize;
  const hasOverlap = messages.length <= totalWindowSize;

  return {
    totalMessages: messages.length,
    activeMessages: activeMessages.length,
    archivedMessages: archivedMessages.length,
    firstMessagesCount: hasOverlap ? messages.length : Math.min(keepFirstMessages, messages.length),
    recentMessagesCount: hasOverlap ? 0 : Math.min(slidingWindowSize, Math.max(0, messages.length - keepFirstMessages)),
  };
}
