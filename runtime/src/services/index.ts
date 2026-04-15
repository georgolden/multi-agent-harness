import { Scheduler, config as schedulerConfig } from './scheduler/index.js';
import { TelegramService, config as telegramConfig } from './telegram/index.js';
import { SandboxService } from './sandbox/index.js';
import { SessionService } from './sessionService/index.js';
import { ChannelService } from './channel/index.js';
import { ComposioService } from './composio/index.js';
import { UserService } from './userService/index.js';
import { UserToolkitService } from './userToolkits/index.js';
import { ToolProviderRegistry } from './toolProviders/toolProvider.js';
import { App } from '../app.js';

export class Services {
  scheduler: Scheduler;
  telegram: TelegramService;
  sandbox: SandboxService;
  sessionService: SessionService;
  channel: ChannelService;
  composio: ComposioService;
  userService: UserService;
  userToolkitService: UserToolkitService;
  toolProviderRegistry: ToolProviderRegistry;

  constructor(app: App) {
    this.scheduler = new Scheduler(app, schedulerConfig);
    this.telegram = new TelegramService(app, telegramConfig);
    this.sandbox = new SandboxService(app);
    this.sessionService = new SessionService(app);
    this.channel = new ChannelService(app);

    // Tool provider registry — register all providers here
    this.toolProviderRegistry = new ToolProviderRegistry();
    this.composio = new ComposioService(app);
    this.toolProviderRegistry.register(this.composio);

    this.userService = new UserService(app);
    this.userToolkitService = new UserToolkitService(app);
  }

  async start() {
    return Promise.all([
      this.scheduler.start(),
      this.telegram.start(),
      this.sandbox.start(),
      this.sessionService.start(),
      this.channel.start(),
      this.composio.start(),
      this.userService.start(),
      this.userToolkitService.start(),
    ]);
  }

  async stop() {
    return Promise.all([
      this.scheduler.stop(),
      this.telegram.stop(),
      this.sandbox.stop(),
      this.sessionService.stop(),
      this.channel.stop(),
      this.composio.stop(),
      this.userService.stop(),
      this.userToolkitService.stop(),
    ]);
  }
}
