//@ts-ignore no types for ton-client-js
import { QMessageType } from 'ton-client-js';
import { AbiContract, KeyPair, ResultOfProcessMessage } from '@eversdk/core';
import OutputDecoder from './output-decoder';
import { Locklift } from '../index';
import { AllowedCodes, PersonalCodes } from 'locklift/tracing';

export type ContractConstructorParams = {
  locklift: Locklift;
  abi: AbiContract;
  base64: string;
  code: string;
  name: string;
  address?: string;
  keyPair?: KeyPair;
  autoAnswerIdOnCall?: boolean;
  autoRandomNonce?: boolean;
  afterRun?: Function;
}

export type RunContractParams = {
  method: string;
  params: any;
  keyPair?: KeyPair;
  no_wait?:boolean;
  tracing?:boolean;
  tracing_allowed_codes?: AllowedCodes | PersonalCodes;
}

/**
 * Smart contract object.
 */
export class Contract {
  protected locklift: Locklift;
  protected keyPair: KeyPair | undefined;
  protected autoAnswerIdOnCall: boolean;
  protected afterRun: Function;
  address: string | undefined;
  base64: string;
  code: string;
  name: string;
  autoRandomNonce: boolean;
  abi: AbiContract;
  /**
   * Contract constructor
   * @param locklift Locklift instance
   * @param abi Contract ABI
   * @param base64 Contract base64 encoded TVC
   * @param code Contract code
   * @param name Contract name
   * @param address Contract address
   * @param keyPair Default keyPair to use for interacting with smart contract
   * @param [autoAnswerIdOnCall=true] Boolean, specify dummy answer_id automatically
   * @param autoRandomNonce Automatically fill _randomNonce in init data if it discovered in ABI
   * @param afterRun After run hook, receives a run transaction.
   */
  constructor({
    locklift,
    abi,
    base64,
    code,
    name,
    address,
    keyPair,
    autoAnswerIdOnCall = true,
    autoRandomNonce = true,
    afterRun = async () => {},
  }: ContractConstructorParams) {
    this.locklift = locklift;
    this.abi = abi;
    this.base64 = base64;
    this.code = code;
    this.name = name;
    this.address = address;
    this.keyPair = keyPair;
    this.afterRun = afterRun;
    this.autoAnswerIdOnCall = autoAnswerIdOnCall;
    this.autoRandomNonce = autoRandomNonce;
  }

  /**
   * Set contract address
   * @param address
   */
  setAddress(address: string): void {
    this.address = address;
    this.locklift.tracing.addToContext(address, this);
  }

  /**
   * Set key pair to use for interacting with contract.
   * @param keyPair
   */
  setKeyPair(keyPair: KeyPair): void {
    this.keyPair = keyPair;
  }

  /**
   * Run smart contract method. Create run message and wait for transaction.
   * @param method Method name
   * @param params Method params
   * @param [keyPair=this.keyPair] Key pair to use
   * @param no_wait Disable waiting until msg tree is finalized. Only first external msg is returned. Force disables tracing
   * @param tracing Force disable or enable tracing for this tx
   * @param tracing_allowed_codes Allowed exit/result codes for compute/actions phases, which will not throw error
   * @returns {Promise<ResultOfProcessMessage>}
   */
  async run({ method, params, keyPair, no_wait, tracing, tracing_allowed_codes }: RunContractParams): Promise<ResultOfProcessMessage> {
    if (!tracing_allowed_codes) tracing_allowed_codes  ={compute: [], action: []}
    const message = await this.locklift.ton.createRunMessage({
      contract: this,
      method,
      params: params === undefined ? {} : params,
      keyPair: keyPair === undefined ? this.keyPair! : keyPair,
    });
  
    const tx = await this.locklift.ton.waitForRunTransaction({ message, abi: this.abi });
    let trace_params = {in_msg_id: tx.transaction.in_msg, allowed_codes: tracing_allowed_codes, no_wait: no_wait, force_trace:false, disable_trace:false}
    if (tracing === true) {
      trace_params.force_trace = true;
    } else if (tracing === false) {
      trace_params.disable_trace = true;
    }

    // return full msg tree
    const msg_tree = await this.locklift.tracing.trace(trace_params);
    msg_tree.decoded = tx.decoded; // for back compatibility
    return msg_tree;
  }

  /**
   * Call smart contract method. Uses runLocal to run TVM code locally and decodes result
   * according to the ABI.
   * @dev Specify _answer_id if necessary in case this.autoAnswerIdOnCall is true
   * @param method Method name
   * @param [params={}] Method params
   * @param [keyPair=this.keyPair] Keypair to use
   * @returns {Promise<void>} Decoded output
   */
  async call({ method, params, keyPair }: RunContractParams): Promise<any> {
    const extendedParams = params === undefined ? {} : params;

    if (this.autoAnswerIdOnCall) {
      if (this.abi.functions?.find(e => e.name === method)?.inputs.find(e => e.name === '_answer_id')) {
        extendedParams._answer_id = extendedParams._answer_id === undefined ? 1 : extendedParams._answer_id;
      } else if (this.abi.functions?.find(e => e.name === method)?.inputs.find(e => e.name === 'answerId')) {
        extendedParams.answerId = extendedParams.answerId === undefined ? 1 : extendedParams.answerId;
      }
    }

    const {
      message
    } = await this.locklift.ton.createRunMessage({
      contract: this,
      method,
      params: extendedParams,
      keyPair: keyPair === undefined ? this.keyPair! : keyPair,
    });

    const {
      result: [{
        boc
      }]
    } = await this.locklift.ton.client.net.query_collection({
      collection: 'accounts',
      filter: {
        id: {
          eq: this.address,
        }
      },
      result: 'boc'
    });

    // Get output of the method run execution
    const { decoded } = await this.locklift.ton.client.tvm.run_tvm({
      abi: {
        type: 'Contract',
        value: this.abi
      },
      message: message,
      account: boc,
    });

    // Decode output
    const functionAttributes = this.abi.functions!.find(({ name }) => name === method)!;

    const outputDecoder = new OutputDecoder(
      decoded!,
      functionAttributes
    );
  
    return outputDecoder.decodeFlat();
  }

  /**
   * Decode list of messages according to the ABI
   * @param messages
   * @param is_internal
   * @returns {Promise<unknown[]>}
   */
  async decodeMessages(
    messages: Array<{ body: string, id: string, src: string, created_at: number }>,
    is_internal: boolean
  ) {
    const decodedMessages = messages.map(async (message) => {
      const decodedMessage = await this.locklift.ton.client.abi.decode_message_body({
        abi: {
          type: 'Contract',
          value: this.abi
        },
        body: message.body,
        is_internal,
      });

      return {
        ...decodedMessage,
        messageId: message.id,
        src: message.src,
        created_at: message.created_at
      };
    });

    return Promise.all(decodedMessages);
  }

  /**
   * Get list of messages, sent from the contract
   * @param messageType Message type
   * @param internal Internal type
   * @returns {Promise<unknown[]>} List of messages
   */
  async getSentMessages(messageType: string, internal: boolean) {
    const {
      result
    } = (await this.locklift.ton.client.net.query_collection({
          collection: 'messages',
          filter: {
            src: {
              eq: this.address
            },
            msg_type: {
              eq: messageType
            }
          },
          result: 'body id src created_at',
          limit: 1000,
          order: [{path: 'created_at', direction: 'DESC' as any}]
        }
    ));

    return this.decodeMessages(result, internal);
  }

  /**
   * Get solidity events, emitted by the contract.
   * @dev Under the hood, events are extOut messages
   * @param eventName Event name
   * @returns {Promise<*>} List of emitted events
   */
  async getEvents(eventName: string) {
    const sentMessages = await this.getSentMessages(QMessageType.extOut, false);

    return sentMessages.filter((message) => message.name === eventName);
  }
}


export { Account } from './account';
