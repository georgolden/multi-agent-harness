import { Bus } from './bus.js';
import type { App } from '../app.js';
export declare class Infra {
    bus: Bus;
    constructor(app: App);
    start(): Promise<void>;
    stop(): Promise<void>;
}
