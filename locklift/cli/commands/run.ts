import vm from "vm";
import fs from "fs";
import path from "path";
import { Command } from "commander";

import { loadConfig } from "./../../config";
import { Locklift } from "./../../index";
import * as utils from "./../utils";
import { create, createRepl } from "ts-node";

const program = new Command();

program
  .name("run")
  .description("Run arbitrary locklift script")
  .option("--disable-build", "Disable automatic contracts build", false)
  .option(
    "-c, --contracts <contracts>",
    "Path to the contracts folder",
    "contracts"
  )
  .option("-b, --build <build>", "Path to the build folder", "build")
  .option(
    "--external-build [build...]",
    "Paths to externally built contract folders"
  )
  .option("--enable-tracing", "Enable transaction tracing (experimental)")
  .option(
    "--disable-include-path",
    "Disables including node_modules. Use this with old compiler versions",
    false
  )
  .requiredOption(
    "-n, --network <network>",
    "Network to use, choose from configuration"
  )
  .option(
    "--config <config>",
    "Path to the config file",
    async config => loadConfig(config),
    loadConfig(utils.DEFAULT_CONFIG_FILE)
  )
  .requiredOption("-s, --script <script>", "Script to run")
  .allowUnknownOption()
  .action(async options => {
    const config = await options.config;

    if (config.networks[options.network] === undefined) {
      console.error(`Can't find configuration for ${options.network} network!`);

      process.exit(1);
    }

    if (options.disableBuild !== true) {
      utils.initializeDirIfNotExist(options.build);

      const builder = new utils.Builder(config, options);

      const status = builder.buildContracts();

      if (status === false) process.exit(1);
    }

    // Initialize Locklift
    const locklift = new Locklift(config, options);

    await locklift.setup();

    //@ts-ignore
    global.locklift = locklift;
    global.__dirname = __dirname;

    //@ts-ignore
    global.require = p => {
      const script = options.script.split("/");
      script.pop();

      return p.startsWith(".")
        ? require(path.resolve(process.cwd(), script.join("/"), p))
        : require(p);
    };

    const scriptCode = fs.readFileSync(options.script);
    const script = new vm.Script(scriptCode.toString());
    script.runInThisContext();
  });

export default program;
