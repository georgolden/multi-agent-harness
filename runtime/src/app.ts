import { Data } from './data/index.js';
import { Flows } from './flows/index.js';
import { Infra } from './infra/index.js';
import { Services } from './services/index.js';
import { Skills } from './skills/index.js';
import { Tasks } from './tasks/index.js';
import { Tools } from './tools/index.js';
import { AppServer } from './server/index.js';

export class App {
  services: Services;
  infra: Infra;
  data: Data;
  flows: Flows;
  skills: Skills;
  tasks: Tasks;
  tools: Tools;
  server: AppServer;

  constructor() {
    const cwd = process.cwd();
    this.infra = new Infra(this);
    this.services = new Services(this);
    this.data = new Data(this);
    this.flows = new Flows(this);
    this.skills = new Skills(cwd);
    this.tasks = new Tasks(this);
    this.tools = new Tools(cwd);
    this.server = new AppServer(this);
  }

  async start() {
    await Promise.all([
      this.services.start(),
      this.infra.start(),
      this.data.start(),
      this.skills.start(),
      this.flows.start(),
    ]);
    await this.server.start();
  }

  async stop() {
    try {
      await this.server.stop();
      await Promise.all([this.services.stop(), this.infra.stop(), this.data.stop(), this.skills.stop()]);
    } catch (error) {
      console.error(error);
    }
  }
}
