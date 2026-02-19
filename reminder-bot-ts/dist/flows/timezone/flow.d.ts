import { Flow } from 'pocketflow';
import type { SharedStore } from '../../types.js';
import type { TimezoneContext } from './types.js';
export type TimezoneFlow = Flow<SharedStore<TimezoneContext>>;
export declare function createTimezoneFlow(): Flow<SharedStore<TimezoneContext>>;
