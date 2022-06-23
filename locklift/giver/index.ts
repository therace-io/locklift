import { Contract, ContractConstructorParams } from './../contract';
import { CreateDeployMessageParams } from '../ton';
import { Locklift } from '../index';


/**
 * Locklift plugin for working with classic givers.
 * Supports giver from local-node and any compatible one
 */
export class Giver {
  private locklift: Locklift;
  private giver!: Contract;

  constructor(locklift: Locklift) {
    this.locklift = locklift;
  }

  /**
   * Deploys contract by using giver.
   * 1. Derives contract address
   * 2. Sends specified amount of TONs to address
   * 3. Waits for balance to be replenished
   * 4. Deploys contract and setup address
   * @param contract Contract instance to deploy
   * @param constructorParams Constructor parameters data
   * @param initParams Initial data
   * @param keyPair Key pair to use
   * @param tracing Force enable or disable transaction tracing
   * @param tracing_allowed_codes Allowed exit/result codes for compute/actions phases, which will not throw error
   * @param [amount=locklift.utils.convertCrystal(10, 'nano')] Amount in nano TONs to request from giver
   * @returns {Promise<*>}
   */
  async deployContract(
    {
      contract,
      constructorParams,
      initParams,
      keyPair,
      tracing,
      tracing_allowed_codes
    }: CreateDeployMessageParams,
    amount=this.locklift.utils.convertCrystal(10, this.locklift.utils.Dimensions.Nano)
  ) {
    if (!tracing_allowed_codes) tracing_allowed_codes= {compute: [], action: []}
    // Extend init params with random _randomNonce if it's found in ABI and autoRandomNonce is enabled
    const extendedInitParams = initParams === undefined ? {} : initParams;

    if (contract.autoRandomNonce) {
      if (contract.abi.data?.find(e => e.name === '_randomNonce')) {
        extendedInitParams._randomNonce = extendedInitParams._randomNonce === undefined
          ? this.locklift.utils.getRandomNonce()
          : extendedInitParams._randomNonce;
      }
    }

    const {
      address,
    } = await this.locklift.ton.createDeployMessage({
      contract,
      constructorParams,
      initParams: extendedInitParams,
      keyPair,
      tracing,tracing_allowed_codes
    });

    await this.giver.run({
      method: 'sendGrams',
      params: {
        dest: address,
        amount,
      },
      tracing_allowed_codes: {compute: []},
    });

    // Wait for receiving grams
    await this.locklift.ton.client.net.wait_for_collection({
      collection: 'accounts',
      filter: {
        id: { eq: address },
        balance: { gt: `0x0` }
      },
      result: 'balance'
    });

    // Send deploy transaction
    const message = await this.locklift.ton.createDeployMessage({
      contract,
      constructorParams,
      initParams: extendedInitParams,
      keyPair,
      tracing,
      tracing_allowed_codes
    });
    
    const tx = await this.locklift.ton.waitForRunTransaction({ message, abi: contract.abi });
    let trace_params = {in_msg_id: tx.transaction.in_msg, allowed_codes: tracing_allowed_codes,force_trace:false, disable_trace:false}
    if (tracing === true) {
      trace_params.force_trace = true;
    } else if (tracing === false) {
      trace_params.disable_trace = true;
    }
    await this.locklift.tracing.trace(trace_params);
    contract.setAddress(address);

    return contract;
  }

  async setup() {
    this.giver = new Contract({
      locklift: this.locklift,
      abi: this.locklift.networkConfig.giver.abi,
      address: this.locklift.networkConfig.giver.address,
      name: 'Giver',
    } as ContractConstructorParams);
    this.locklift.tracing.addToContext(this.locklift.networkConfig.giver.address, this.giver);
    
    // Setup giver key in case of key-protected giver
    if (this.locklift.networkConfig.giver.key) {
      const keyPair = await this.locklift.ton.client.crypto.nacl_sign_keypair_from_secret_key({
        secret: this.locklift.networkConfig.giver.key
      });

      // TODO: looks like bug in SDK, keypair.secret is extended with keypair.public
      keyPair.secret = keyPair.secret.slice(0, 64);

      this.giver.setKeyPair(keyPair);
    }
  }
}
