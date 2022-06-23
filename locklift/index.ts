import { Factory } from "./factory";
import { Giver } from "./giver";
import { Keys } from "./keys";
import { Ton } from "./ton";
import Tracing from "./tracing";
import { LockliftConfig } from "./config";
import { ValueOf } from "./types";
import * as utils from "./utils";
import * as contract from "./contract";

export type LockliftOptions = {
  build: any;
  network: string;
  enableTracing: boolean;
  externalBuild: boolean;
};

export class Locklift {
  config: LockliftConfig;
  networkConfig: ValueOf<LockliftConfig["networks"]>;
  network: keyof LockliftConfig["networks"];
  ton!: Ton;
  keys!: Keys;
  factory!: Factory;
  giver!: Giver;
  tracing: any;
  utils = utils;
  build: any;
  enable_tracing: boolean;
  external_build: any;

  constructor(config: LockliftConfig, options: LockliftOptions) {
    this.config = config;
    this.network = options.network;
    this.build = options.build;
    this.enable_tracing = options.enableTracing;
    this.external_build = options.externalBuild;

    this.networkConfig = this.config.networks[this.network];
  }

  async setup() {
    this.ton = new Ton(this);
    this.factory = new Factory(this);
    this.giver = new Giver(this);
    this.keys = new Keys(this);
    this.tracing = new Tracing(this, this.enable_tracing);

    await this.ton.setup();
    await this.factory.setup();
    await this.giver.setup();
    await this.keys.setup();
  }
}

export { contract };
