import { EventEmitter } from 'node:events';
export class Bus extends EventEmitter {
    constructor() {
        super();
    }
    start = async () => { };
    stop = async () => { };
}
