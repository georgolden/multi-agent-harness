/**
 * PocketFlow flow for the reminder agent.
 * Connects all nodes in a clear, directed graph.
 */
import { Flow } from 'pocketflow';
import type { SharedStore } from '../../types.js';
import type { ReminderContext } from './types.js';
export type ReminderFlow = Flow<SharedStore<ReminderContext>>;
/**
 * Create and return the reminder agent flow
 */
export declare function createReminderFlow(): Flow<SharedStore<ReminderContext>>;
