import { Data } from './data/index.js';
import { Flows } from './flows/index.js';
import { Infra } from './infra/index.js';
import { Services } from './services/index.js';
export declare class App {
    services: Services;
    infra: Infra;
    data: Data;
    flows: Flows;
    constructor();
    start(): Promise<[[void, void], void, void]>;
    stop(): Promise<[[void, void], void, void]>;
}
