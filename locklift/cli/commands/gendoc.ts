import { Command, Option } from 'commander';

import { loadConfig } from './../../config';
import * as utils from './../utils';

const program = new Command();


program.name('gendoc')
  .description('Generate smart contracts documentation from the natspec comments')
  .option('-c, --contracts <contracts>', 'Path to the contracts folder', 'contracts')
  .option('-b, --build <build>', 'Path to the build folder', 'build')
    .option(
        '--disable-include-path',
        'Disables including node_modules. Use this with old compiler versions',
        false
    )
  .option('-d, --docs <docs>', 'Path to the docs folder', 'docs')
  .option(
    '-i, --include <include>',
    'Generate docs only for contracts, whose name matches the patters',
    '.*'
  )
  .addOption(
    new Option('-m, --mode <mode>', 'Mode for compiler doc generator')
      .default('devdoc')
      .choices(['devdoc', 'userdoc'])
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
    utils.initializeDirIfNotExist(options.docs);

    const builder = new utils.Builder(config, options);

    try {
      const status = builder.buildDocs();

      if (status === false) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    } catch (e) {
      console.log(e);
    }
  });


export default program;
