import { DecodedMessageBody } from '@eversdk/core';
import { Contract } from 'locklift/contract';
import Tracing, { AllowedCodes, PersonalCodes } from '.';
import OutputDecoder from '../contract/output-decoder';
export const TraceType = {
    FUNCTION_CALL: 'function_call',
    FUNCTION_RETURN: 'function_return',
    DEPLOY: 'deploy',
    EVENT: 'event',
    EVENT_OR_FUNCTION_RETURN: 'event_or_return',
    BOUNCE: 'bounce',
    TRANSFER: 'transfer'
}


const CONSOLE_ADDRESS = '0:7fffffffffffffffffffffffffffffffffffffffffffffffff123456789abcde';


export class Trace {
    tracing: Tracing;
    msg: any;
    src_trace: Trace | null;
    out_traces: Trace[];
    error: null | {
        ignored?: boolean;phase: string; code:number;
};
    contract: null | Contract;
    type: null | string;
    decoded_msg: null | DecodedMessageBody;
    has_error_in_tree: boolean;
    decoded_params: any;

    constructor(tracing: Tracing, msg: any, src_trace: Trace | null) {
        this.tracing = tracing;
        this.msg = msg; // msg tree
        this.src_trace = src_trace ?? null;
        this.out_traces = [];

        this.error = null;
        this.contract = null;
        this.type = null;
        this.decoded_msg = null;

        // this propagates to the root of trace tree if error occurred on any trace node
        this.has_error_in_tree = false;
    }

    async buildTree(allowed_codes={compute: [], action: [], any: {compute: [], action: []}}) {
        this.setMsgType();
        this.checkForErrors(allowed_codes);
        await this.decode();
        for (const msg of this.msg.out_messages) {
            const trace = new Trace(this.tracing, msg, this);
            await trace.buildTree(allowed_codes);
            if (trace.has_error_in_tree) {
                this.has_error_in_tree = true;
            }
            this.out_traces.push(trace);
        }
    }

    // allowed_codes - {compute: [100, 50, 12], action: [11, 12]}
    checkForErrors(allowed_codes: AllowedCodes | PersonalCodes) {
        const tx = this.msg.dst_transaction;
        allowed_codes.compute = allowed_codes.compute?? [];
        allowed_codes.action = allowed_codes.action ?? [];

        if (this.msg.dst === CONSOLE_ADDRESS) {
            return;
        }

        let skip_compute_check = false;
        if (tx && (tx.compute.success || tx.compute.compute_type === 0) && !tx.aborted) {
            skip_compute_check = true;
        }
        let skip_action_check = false;
        if (tx && tx.action && tx.action.success) {
            skip_action_check = true;
        }

        // error occured during compute phase
        if (!skip_compute_check && tx && tx.compute.exit_code !== 0) {
            this.error = {phase: 'compute', code: tx.compute.exit_code}
            // we didnt expect this error, save error
            if (
                (allowed_codes as PersonalCodes).compute!.indexOf(tx.compute.exit_code) > -1 ||
                ((allowed_codes as AllowedCodes)[this.msg.dst] && (allowed_codes as AllowedCodes)[this.msg.dst].compute!.indexOf(tx.compute.exit_code) > -1)
            ) {
                this.error!.ignored = true;
            }
        } else if (!skip_action_check && tx && tx.action && tx.action.result_code !== 0) {
            this.error = {phase: 'action', code: tx.action.result_code}
            // we didnt expect this error, save error
            if (
                (allowed_codes as PersonalCodes).action!.indexOf(tx.action.result_code) > -1 ||
                ((allowed_codes as AllowedCodes)[this.msg.dst] && (allowed_codes as AllowedCodes)[this.msg.dst].action!.indexOf(tx.action.result_code) > -1)
            ) {
                this.error.ignored = true;
            }
        }
        if (this.error && !this.error.ignored) {
            this.has_error_in_tree = true;
        }
    }

    async decodeMsg(contract: Contract | null) {
        if (contract === null) {
            contract = this.contract;
        }

        if (this.msg.dst === CONSOLE_ADDRESS) {
            return;
        }

        if (this.type === TraceType.TRANSFER || this.type === TraceType.BOUNCE) {
            return;
        }

        if (this.type === TraceType.FUNCTION_CALL && this.src_trace) {
            // this is responsible callback with answerId = 0, we cant decode it, however contract doesnt need it too
            if (this.src_trace.decoded_msg && this.src_trace.decoded_msg.value.answerId === '0') {
                return;
            }
        }

        // function call, but we dont have contract here => we cant decode msg
        if (this.type === TraceType.FUNCTION_CALL && !contract) {
            return;
        }

        // 60 error on compute phase - wrong function id. We cant decode this msg with contract abi
        if (this.error && this.error.phase === 'compute' && this.error.code === 60) {
            return;
        }

        if (!contract) {
            return;
        }

        const is_internal = this.msg.msg_type === 0;
        this.decoded_msg = await this.tracing.locklift.ton.client.abi.decode_message_body({
            abi: {
                type: 'Contract',
                value: contract.abi
            },
            body: this.msg.body,
            is_internal: is_internal
        });


        // determine more precisely is it an event or function return
        if (this.type === TraceType.EVENT_OR_FUNCTION_RETURN) {
            const is_function_return = contract.abi.functions!.find(({ name }) => name === this.decoded_msg!.name);
            if (is_function_return) {
                this.type = TraceType.FUNCTION_RETURN;
            } else {
                this.type = TraceType.EVENT;
            }
        }
        this.decoded_params = OutputDecoder.autoDecode(this.decoded_msg! as any, contract.abi as any);

        if (this.type === TraceType.DEPLOY && (contract.name === 'Platform' || contract.name === 'DexPlatform')) {
            // replace with real contract
            const platform_type = contract.name;
            await this.initContractByCode(this.decoded_msg.value.code);
            (this.contract as any)!.platform = platform_type;
        }
    }

    // find which contract is deployed in this msg by code hash
    async initContract() {
        this.contract = (await this.getContractByCodeHash(this.msg.code_hash))!;
        this.contract?.setAddress(this.msg.dst);
    }

    async getContractByCodeHash(code_hash: any) {
        for (const contract_data of Object.values(this.tracing.locklift.factory.artifacts)) {
            if (contract_data.code_hash === code_hash) {
                return await this.tracing.locklift.factory.getContract(contract_data.name, contract_data.build);
            }
        }
    }

    async initContractByCode(code: any) {
        for (const contract_data of Object.values(this.tracing.locklift.factory.artifacts)) {
            if (contract_data.code === code) {
                this.contract = await this.tracing.locklift.factory.getContract(contract_data.name, contract_data.build);
                this.contract.setAddress(this.msg.dst); // added to context automatically
                return;
            }
        }
    }

    async decode() {
        let contract = null;
        switch (this.type) {
            case TraceType.DEPLOY:
                // dont init contract if error occured, just try to decode msg
                // we dont want to add to context non-existent contract
                if (this.error) {
                    contract = await this.getContractByCodeHash(this.msg.code_hash);
                } else {
                    await this.initContract();
                }
                break;
            case TraceType.FUNCTION_CALL:
                // get contract from context
                this.contract = this.tracing.getFromContext(this.msg.dst);
                break;
            case TraceType.EVENT:
                this.contract = this.tracing.getFromContext(this.msg.src);
                break;
            case TraceType.EVENT_OR_FUNCTION_RETURN:
                this.contract = this.tracing.getFromContext(this.msg.src);
                break
            case TraceType.BOUNCE:
                this.contract = this.tracing.getFromContext(this.msg.dst);
        }
        // if contract is null, will take this.contract by default
        await this.decodeMsg(contract!);
    }

    setMsgType() {
        switch (this.msg.msg_type) {
            // internal - deploy or function call or bound or transfer
            case 0:
                // code hash is presented, deploy
                if (this.msg.code_hash !== null) {
                    this.type = TraceType.DEPLOY;
                    // bounced msg
                } else if (this.msg.bounced === true) {
                    this.type = TraceType.BOUNCE;
                    // empty body, just transfer
                } else if (this.msg.body === null) {
                    this.type = TraceType.TRANSFER;
                } else {
                    this.type = TraceType.FUNCTION_CALL;
                }
                return;
            // extIn - deploy or function call
            case 1:
                if (this.msg.code_hash !== null) {
                    this.type = TraceType.DEPLOY;
                } else {
                    this.type = TraceType.FUNCTION_CALL;
                }
                return;
            // extOut - event or return
            case 2:
                // if this msg was produced by extIn msg, this can be return or event
                if (this.src_trace !== null && this.src_trace.msg.msg_type === 1) {
                    this.type = TraceType.EVENT_OR_FUNCTION_RETURN;
                } else {
                    this.type = TraceType.EVENT;
                }
                return;
            default:
                return;
        }
    }
}
