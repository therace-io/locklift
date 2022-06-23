import BigNumber from "bignumber.js";
import { Contract } from "./index";
import { CreateRunMessageParams } from "../ton";
import { AllowedCodes, PersonalCodes } from "locklift/tracing";
import { ResultOfProcessMessage } from "@eversdk/core";

export type RunTargetParams = Partial<CreateRunMessageParams> & {
  contract: Contract;
  value?: string | BigNumber;
  no_wait?: boolean;
  tracing?: boolean;
  tracing_allowed_codes?: AllowedCodes | PersonalCodes;
};

/**
 * Account contract wrapping. Extending Contract object. Implements method
 * for internal calling other contracts by calling sendTransaction method.
 */
export class Account extends Contract {
  /**
   * Run another contracts method as internal message
   * If method and params not specified - sends value without payload.
   * You may use Account contract of create your own contract with same sendTransaction signature
   * @param contract Contract instance
   * @param method Contract's method name
   * @param params Contract's method params
   * @param [value=this.locklift.utils.convertCrystal('2', 'nano')] Value to attach in nano TONs
   * @param [keyPair=this.keyPair] Key pair to use
   * @param no_wait Disable waiting until msg tree is finalized. Only first external msg is returned. Force disables tracing
   * @param tracing Force enable or disable tracing for this tx
   * @param tracing_allowed_codes Allowed exit/result codes for compute/actions phases, which will not throw error
   * @returns {Promise<*>}
   */
  async runTarget({
    contract,
    method,
    params,
    value,
    keyPair,
    no_wait,
    tracing,
    tracing_allowed_codes
  }: RunTargetParams): Promise<ResultOfProcessMessage> {
    let body = "";
    if (!tracing_allowed_codes)
      tracing_allowed_codes = { compute: [], action: [] };

    if (method !== undefined) {
      const extendedParams = params === undefined ? {} : params;

      if (this.autoAnswerIdOnCall) {
        if (
          contract.abi.functions
            ?.find(e => e.name === method)
            ?.inputs.find(e => e.name === "_answer_id")
        ) {
          extendedParams._answer_id =
            extendedParams._answer_id === undefined
              ? 1
              : extendedParams._answer_id;
        } else if (
          contract.abi.functions
            ?.find(e => e.name === method)
            ?.inputs.find(e => e.name === "answerId")
        ) {
          extendedParams.answerId =
            extendedParams.answerId === undefined ? 1 : extendedParams.answerId;
        }
      }

      const message = await this.locklift.ton.client.abi.encode_message_body({
        abi: {
          type: "Contract",
          value: contract.abi
        },
        call_set: {
          function_name: method,
          input: extendedParams
        },
        signer: {
          type: "None"
        },
        is_internal: true
      });

      body = message.body;
    }

    return this.run({
      method: "sendTransaction",
      params: {
        dest: contract.address,
        value:
          value === undefined
            ? this.locklift.utils.convertCrystal(
                "2",
                this.locklift.utils.Dimensions.Nano
              )
            : value,
        bounce: true,
        flags: 0,
        payload: body
      },
      keyPair: keyPair === undefined ? this.keyPair : keyPair,
      no_wait: no_wait,
      tracing: tracing,
      tracing_allowed_codes: tracing_allowed_codes
    });
  }
}
