import fs from "fs";
import path from "path";
import commander from "commander";
import {
  object,
  string,
  defaulted,
  create,
  any,
  integer,
  record
} from "superstruct";
import { TonClient } from "@eversdk/core";
import { libNode } from "@eversdk/lib-node";

TonClient.useBinaryLibrary(libNode);

export interface LockliftConfig {
  compiler: {
    path: string;
  };
  linker: {
    path: string;
    lib?: string;
  };
  networks: Record<
    "local" | string,
    {
      giver: {
        address: string;
        abi: Record<string, unknown>;
        key: string;
      };
      keys: {
        path: string;
        phrase: string;
        amount: number;
      };
      ton_client?: {
        network: {
          server_address: string;
        };
      };
    }
  >;
}

const Compiler = object({
  path: defaulted(string(), () => "/usr/bin/solc-ton")
});

const Linker = object({
  path: defaulted(string(), () => "/usr/bin/tvm_linker"),
  lib: defaulted(string(), () => "/root/.everdev/solidity/stdlib_sol.tvm")
});

const Giver = object({
  address: string(),
  abi: object(),
  key: string()
});

const Keys = object({
  phrase: string(),
  amount: defaulted(integer(), () => 25),
  path: defaulted(string(), () => "m/44'/396'/0'/0/INDEX")
});

const Network = object({
  ton_client: any(),
  giver: Giver,
  keys: Keys
});

const Config = object({
  compiler: Compiler,
  linker: Linker,
  networks: record(string(), Network)
});

export async function loadConfig(configPath: string) {
  const resolvedConfigPath = path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(resolvedConfigPath)) {
    throw new commander.InvalidOptionArgumentError(
      `Config at ${configPath} not found!`
    );
  }

  const configFile = require(resolvedConfigPath);

  const config = create(configFile, Config);

  // Ad hoc
  // Since superstruct not allows async default value, default mnemonic phrases are generated bellow
  function genHexString(len: number): string {
    const str = Math.floor(Math.random() * Math.pow(16, len)).toString(16);
    return "0".repeat(len - str.length) + str;
  }

  const client = new TonClient();

  config.networks = await Object.entries(config.networks).reduce(
    async (accP, [network, networkConfig]) => {
      const acc = await accP;

      if (networkConfig.keys.phrase === "") {
        const entropy = genHexString(32);

        const { phrase } = await client.crypto.mnemonic_from_entropy({
          entropy,
          word_count: 12
        });

        networkConfig.keys.phrase = phrase;
      }

      return {
        ...acc,
        [network]: networkConfig
      };
    },
    Promise.resolve({})
  );

  return config;
}
