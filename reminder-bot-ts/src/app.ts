import { Data } from './data/index.js';
import { Flows } from './flows/index.js';
import { Infra } from './infra/index.js';
import { Services } from './services/index.js';

export class App {
  services: Services;
  infra: Infra;
  data: Data;
  flows: Flows;

  constructor() {
    this.services = new Services(this);
    this.infra = new Infra(this);
    this.data = new Data(this);
    this.flows = new Flows(this);
  }

  async start() {
    return Promise.all([this.services.start(), this.infra.start(), this.data.start()]);
  }

  async stop() {
    return Promise.all([this.services.stop(), this.infra.stop(), this.data.stop()]);
  }
}
