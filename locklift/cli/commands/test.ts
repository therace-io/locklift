import { Command } from 'commander';
import Mocha from 'mocha';
import path from 'path';
import dirTree from "directory-tree";

import { loadConfig } from './../../config';
import { Locklift } from './../../index';
import * as utils from './../utils';

const program = new Command();
require('ts-mocha')

program
  .name('test')
  .description('Run mocha tests')
  .option('--disable-build', 'Disable automatic contracts build', false)
  .option('-t, --test <test>', 'Path to Mocha test folder', 'test')
  .option('-c, --contracts <contracts>', 'Path to the contracts folder', 'contracts')
  .option('-b, --build <build>', 'Path to the build folder', 'build')
  .option('--external-build [build...]', 'Paths to externally built contract folders')
  .option('--enable-tracing', 'Enable transaction tracing (experimental)')
    .option(
        '--disable-include-path',
        'Disables including node_modules. Use this with old compiler versions',
        false
    )
  .requiredOption(
    '-n, --network <network>',
    'Network to use, choose from configuration'
  )
  .option(
    '--config <config>',
    'Path to the config file',
    async (config) => loadConfig(config),
    (loadConfig(utils.DEFAULT_CONFIG_FILE))
  )
  .option(
    '--tests [tests...]',
    'Set of tests to run, separated by comma',
  )
  .allowUnknownOption()
  .action(async (options) => {
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

    // Initialize Locklift and pass it into tests context
    const locklift = new Locklift(config, options);
    
    await locklift.setup();

    //@ts-ignore
    global.locklift = locklift;

    // Run mocha tests
    process.env.TS_NODE_PROJECT = './tsconfig.json';
    const mocha = new Mocha();


    // Run all .js files in tests or only specified tests
    let testFiles: string[];

    if (Array.isArray(options.tests)) {
      testFiles = options.tests;
    } else {
      const testNestedTree = dirTree(
        path.resolve(process.cwd(), options.test),
        { extensions: /\.[jt]s/ }
      );

      testFiles = utils.flatDirTree(testNestedTree)?.map(t => t.path) || [];
    }

    testFiles.forEach((file: string) => mocha.addFile(file));
    mocha.run((fail) => process.exit(fail ? 1 : 0));
  });


export default program;
