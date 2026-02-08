import { EventEmitter } from 'node:events';
export declare class Bus extends EventEmitter {
    constructor();
    start: () => Promise<void>;
    stop: () => Promise<void>;
}
