import { Command } from 'commander';
import { loadConfig } from '../../config';
import * as utils from '../utils';

const program = new Command();


program
  .name('build')
  .description('Build contracts by using TON Solidity compiler and TVM linker')
  .option('-c, --contracts <contracts>', 'Path to the contracts folder', 'contracts')
  .option('-b, --build <build>', 'Path to the build folder', 'build')
  .option(
      '--disable-include-path',
      'Disables including node_modules. Use this with old compiler versions',
      false
  )
  .option(
      '--config <config>',
      'Path to the config file',
      async (config) => loadConfig(config),
      (loadConfig(utils.DEFAULT_CONFIG_FILE))
  )
  .action(async (options) => {
    const config = await options.config;

    utils.initializeDirIfNotExist(options.build);

    const builder = new utils.Builder(config, options);

    const status = builder.buildContracts();

    if (status === false) process.exit(1);

    process.exit(0);
  });

export default program;
