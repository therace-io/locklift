import dirTree from 'directory-tree'
import * as utils from './../utils'
import { flatDirTree } from '../cli/utils';
import { Contract } from './../contract';
import { Account } from './../contract';
import fs from 'fs'
import { Locklift } from 'locklift';
import {ResultOfDecodeTvc} from '@eversdk/core'

export interface Artifact extends ResultOfDecodeTvc  {
name:string;
abi:any;
base64:string;
build:string;
}

/**
 * Factory object for generating initializing Contract objects.
 */
export class Factory {
  private locklift: Locklift;
  build: any;
  external_build: any[];
  artifacts: {[name:string]: Artifact;};

  constructor(locklift: Locklift) {
    this.locklift = locklift;
    this.build = this.locklift.build
    this.external_build = this.locklift.external_build
    this.artifacts = {}
  }

  /**
   * Initialize Contract object by it's name and build path.
   * Loads Base64 TVC encoded, ABI, derive code from base64 TVC.
   * @param name
   * @param resolvedPath
   * @returns {Promise<Contract>}
   */
  async initializeContract(name: string, resolvedPath: any) {
    let abi, code, base64;
    const cached = this.artifacts[`${resolvedPath}/${name}`];
    if (cached) {
      ({ abi, code, base64 } = cached);
    } else {
      base64 = utils.loadBase64FromFile(`${resolvedPath}/${name}.base64`);
      abi = utils.loadJSONFromFile(`${resolvedPath}/${name}.abi.json`);
      ({ code } = await this.locklift.ton
          .client
          .boc
          .get_code_from_tvc({
            tvc: base64,
          }));
    }
  
    return new Contract({
      locklift: this.locklift,
      abi,
      base64,
      code:code!,
      name,
    });
  }

  /**
   * Get contract instance
   * @param name Contract file name
   * @param [build='build'] Build path
   * @returns {Promise<Contract>}
   */
  async getContract(name: string, build=this.build) {
    return this.initializeContract(name, build);
  }
  
  async getAccount(name='Account', build=this.build) {
    const contract = await this.initializeContract(name, build);
    
    return new Account({
      locklift: this.locklift,
      abi: contract.abi,
      base64: contract.base64,
      code: contract.code,
      name: contract.name
    });
  }

  async cacheBuildDir(directory: string) {
    const filesTree = dirTree(directory, { extensions: /\.tvc/ });
    if (filesTree === null) {
      throw new Error(`No such directory - ${directory}`);
    }
    const files_flat = flatDirTree(filesTree);
    await Promise.all(files_flat!.map(async (file) => {
      const tvc = fs.readFileSync(file.path, 'base64');
      const decoded = await this.locklift.ton.client.boc.decode_tvc({tvc: tvc});
      const contract_name = file.name.slice(0, -4);
      const abi = utils.loadJSONFromFile(`${directory}/${contract_name}.abi.json`);
      this.artifacts[`${directory}/${contract_name}`] = {...decoded, name: contract_name, abi: abi, base64: tvc, build: directory};
    }));
  }
  
  async setup() {
    await this.cacheBuildDir(this.build)
    if (this.external_build) {
      await Promise.all(this.external_build.map(async (dir) => {
        await this.cacheBuildDir(dir);
      }));
    }
  }
}
