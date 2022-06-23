import Context from  './context';
import { Trace, TraceType} from './trace';
import ConsoleAbi from '../console.abi.json';
import { Locklift } from 'locklift';


const CONSOLE_ADDRESS = '0:7fffffffffffffffffffffffffffffffffffffffffffffffff123456789abcde';


export type PersonalCodes = {compute?: number[], action?:number[]}

type TraceTree = { error: { ignored: any; }; out_traces: any[];has_error_in_tree?:boolean; }

export type AllowedCodes = {
     [name:string] : PersonalCodes;
    
}

class Tracing {
    locklift: Locklift;
    context: any;
    enabled: boolean;
    allowed_codes: AllowedCodes | PersonalCodes;

    constructor(locklift:Locklift, enabled=false) {
        this.locklift = locklift;
        this.context = new Context(locklift);
        this.enabled = enabled;

        this.allowed_codes = {compute:[], action:[]};
    }

    async setup() {}

    addToContext(address: any, contract: any) {
        this.context.addContract(address, contract)
    }

    getContext() {
        return this.context.getContext()
    }

    getFromContext(address: any) {
        return this.context.getContract(address)
    }

    allowCodes(allowed_codes={compute:[], action:[]}) {
        if (allowed_codes.compute) {
            (this.allowed_codes.compute! as number[]).push(...allowed_codes.compute);
        }
        if (allowed_codes.action) {
            (this.allowed_codes.action! as number[]).push(...allowed_codes.action);
        }
    }

    allowCodesForAddress(address: string | number, allowed_codes={compute:[], action:[]}) {
        if (!(this.allowed_codes as AllowedCodes)[address]) {
            (this.allowed_codes as AllowedCodes)[address] = {compute:[], action:[]};
        }
        if (allowed_codes.compute) {
            (this.allowed_codes as AllowedCodes)[address]!.compute!.push(...allowed_codes.compute);
        }
        if (allowed_codes.action) {
            (this.allowed_codes as AllowedCodes)[address].action!.push(...allowed_codes.action);
        }
    }

    removeAllowedCodesForAddress(address: string | number, allowed_codes={compute:[], action:[]}) {
        if (!(this.allowed_codes as AllowedCodes)[address]) {
            (this.allowed_codes  as AllowedCodes)[address] = {compute:[], action:[]};
        }
        if (allowed_codes.compute) {
            (this.allowed_codes as AllowedCodes)[address]!.compute!.map((code: any) => {
                const idx = (this.allowed_codes  as AllowedCodes)[address].compute!.indexOf(code);
                if (idx > -1) {
                    (this.allowed_codes as AllowedCodes)[address].compute!.splice(idx, 1);
                }
            })
        }
        if (allowed_codes.action) {
            (this.allowed_codes as AllowedCodes)[address].action!.map((code: any) => {
                const idx = (this.allowed_codes as AllowedCodes)[address].action!.indexOf(code);
                if (idx > -1) {
                    (this.allowed_codes as AllowedCodes)[address].action!.splice(idx, 1);
                }
            })
        }
    }

    removeAllowedCodes(allowed_codes={compute:[], action:[]}) {
        if (allowed_codes.compute) {
            allowed_codes.compute.map((code) => {
                const idx = (this.allowed_codes as PersonalCodes).compute!.indexOf(code);
                if (idx > -1) {
                    (this.allowed_codes as PersonalCodes).compute!.splice(idx, 1);
                }
            })
        }
        if (allowed_codes.action) {
            allowed_codes.action.map((code) => {
                const idx = (this.allowed_codes as PersonalCodes).action!.indexOf(code);
                if (idx > -1) {
                    (this.allowed_codes as PersonalCodes).action!.splice(idx, 1);
                }
            })
        }
    }

    async printConsoleMsg(msg: { body: any; }) {
        const decoded_msg = await this.locklift.ton.client.abi.decode_message_body({
            abi: {
                type: 'Contract',
                value: ConsoleAbi
            },
            body: msg.body,
            is_internal: true
        });
        console.log(decoded_msg.value._log);
    }

    async buildMsgTree(in_msg_id: any, only_root=false) {
        const msg_query = `{
          messages(
            filter: {
              id: {
                eq: "${in_msg_id}"
              }
            }
          ) {
            id
            body
            code_hash
            src
            msg_type
            dst
            dst_transaction {
              status
              total_fees
              aborted
              out_msgs
              storage {
                storage_fees_collected
              }
              compute {
                exit_code
                compute_type
                success
                gas_fees
              }
              action {
                result_code
                success
                total_action_fees
              }
            }
            status
            value
            bounced
            bounce
          }
        }`;
        const msg = (await this.locklift.ton.client.net.query({ "query": msg_query })).result.data.messages[0];
        if (only_root) {
            return msg;
        }
        if (msg.dst === CONSOLE_ADDRESS) {
            await this.printConsoleMsg(msg);
        }
        msg.out_messages = [];
        if (msg.dst_transaction && msg.dst_transaction.out_msgs.length > 0) {
            msg.out_messages = await Promise.all(msg.dst_transaction.out_msgs.map(async (msg_id: any) => {
                return await this.buildMsgTree(msg_id);
            }));
        }
        return msg;
    }

    async buildTracingTree(msg_tree: any, allowed_codes={compute: [], action: [], any: {compute: [], action: []}}) {
        const trace = new Trace(this, msg_tree, null);
        await trace.buildTree(allowed_codes);
        return trace;
    }

    // allowed_codes example - {compute: [100, 50, 12], action: [11, 12], "ton_addr": {compute: [60], action: [2]}}
    async trace({
        in_msg_id,
        force_trace=false,
        disable_trace=false,
        no_wait=false,
        allowed_codes={compute: [], action: [], any: {compute: [], action: []}}
    }: {allowed_codes: AllowedCodes | PersonalCodes; in_msg_id:number;force_trace:boolean;disable_trace:boolean;no_wait:boolean;}) {
        if (force_trace === true && disable_trace === true) {
            throw 'You cant force and disable tracing at the same time!'
        }
        if (force_trace === true && no_wait === true) {
            throw 'You cant force tracing and use no-wait at the same time!'
        }

        const msg_tree = await this.buildMsgTree(in_msg_id, no_wait);
        if (disable_trace || no_wait) return msg_tree;
        if (this.enabled || force_trace) {
            // copy global allowed codes
            let allowed_codes_extended = JSON.parse(JSON.stringify(this.allowed_codes));
            for (const [key, value] of Object.entries(allowed_codes)) {
                if (key === 'compute') {
                    allowed_codes_extended.compute.push(...value);
                } else if (key === 'action') {
                    allowed_codes_extended.action.push(...value);
                } else {
                    // key - address, value - {compute:[], action:[]}
                    if (!allowed_codes_extended[key]) {
                        allowed_codes_extended[key] = {compute:[], action:[]};
                    }
                    if (value.compute) {
                        allowed_codes_extended[key].compute.push(...value.compute);
                    }
                    if (value.action) {
                        allowed_codes_extended[key].action.push(...value.action);
                    }
                }
            }
            if (allowed_codes.compute) {
                allowed_codes_extended.compute.push(...(allowed_codes as PersonalCodes).compute!);
            }
            if (allowed_codes.action) {
                allowed_codes_extended.action.push(...(allowed_codes as PersonalCodes).action!);
            }
            const trace_tree = await this.buildTracingTree(msg_tree, allowed_codes_extended);
            const reverted = this.findRevertedBranch(trace_tree as any);
            if (reverted) {
                this.throwErrorInConsole(reverted);
            }
        }
        return msg_tree;
    }

    _convert(number: number | null, decimals=9, precision=4) {
        if (number === null) {
            return null;
        }
        return (number / 10**decimals).toPrecision(precision);
    }

    throwErrorInConsole(reverted_branch: any) {
        for (const {total_actions, action_idx, trace} of reverted_branch) {
            const bounce = trace.msg.bounce;
            let name = 'undefinedContract';
            if (trace.contract) {
                name = trace.contract.name;
                if (trace.contract.platform) {
                    name = `(${trace.contract.platform})${name}`;
                }
            }
            let method = 'undefinedMethod';
            if (trace.decoded_msg) {
                method = trace.decoded_msg.name;
            } else if (trace.type === TraceType.BOUNCE) {
                method = 'onBounce'
            }
            let params_str = '()';
            if (trace.decoded_params) {
                if (Object.values(trace.decoded_params).length === 0) {
                    params_str = `()`;
                } else {
                    params_str = `(\n`;
                    for (const [key, value] of Object.entries(trace.decoded_params)) {
                        params_str += `    ${key}: ${value}\n`
                    }
                    params_str += ')';
                }
            }

            console.log('\t\t⬇\n\t\t⬇');
            console.log(`\t#${action_idx + 1} action out of ${total_actions}`)
            // green tags
            console.log(`Addr: \x1b[32m${trace.msg.dst}\x1b[0m`)
            console.log(`MsgId: \x1b[32m${trace.msg.id}\x1b[0m`)
            console.log('-----------------------------------------------------------------')
            if (trace.type === TraceType.BOUNCE) {
                console.log('-> Bounced msg')
            }
            if (trace.error && trace.error.ignored) {
                console.log(`-> Ignored ${trace.error.code} code on ${trace.error.phase} phase`)
            }
            if (!trace.contract) {
                console.log('-> Contract not deployed/Not recognized because build artifacts not provided')
            }
            // bold tag
            console.log(`\x1b[1m${name}.${method}\x1b[22m{value: ${this._convert(trace.msg.value)}, bounce: ${bounce}}${params_str}`)
            if (trace.msg.dst_transaction) {
                if (trace.msg.dst_transaction.storage) {
                    console.log(`Storage fees: ${this._convert(trace.msg.dst_transaction.storage.storage_fees_collected)}`)
                }
                if (trace.msg.dst_transaction.compute) {
                    console.log(`Compute fees: ${this._convert(Number(trace.msg.dst_transaction.compute.gas_fees))}`)
                }
                if (trace.msg.dst_transaction.action) {
                    console.log(`Action fees: ${this._convert(Number(trace.msg.dst_transaction.action.total_action_fees))}`)
                }
                console.log(`\x1b[1mTotal fees:\x1b[22m ${this._convert(Number(trace.msg.dst_transaction.total_fees))}`)
            }
            if (trace.error && !trace.error.ignored) {
                // red tag
                console.log('\x1b[31m', `!!! Reverted with ${trace.error.code} error code on ${trace.error.phase} phase !!!`)
                throw new Error(`Reverted with ${trace.error.code} code on ${trace.error.phase} phase`)
            }
        }
    }

    // apply depth-first search on trace tree, return first found reverted branch
    findRevertedBranch(trace_tree:TraceTree) {
        if (trace_tree.has_error_in_tree !== true) {
            return;
        }
        return this.depthSearch(trace_tree, 1, 0);
    }

    depthSearch(trace_tree: TraceTree, total_actions: number, action_idx: number): null | {total_actions: number; action_idx: number; trace: { error: { ignored: any; }; out_traces: any[]; }}[] {
        if (trace_tree.error && !trace_tree.error.ignored) {
            // clean unnecessary structure
            trace_tree.out_traces = [];
            return [{total_actions: total_actions, action_idx: action_idx, trace: trace_tree}];
        }

        for (const [index, trace] of trace_tree.out_traces.entries()) {
            const actions_num = trace_tree.out_traces.length;
            const corrupted_branch = this.depthSearch(trace, actions_num, index);
            if (corrupted_branch) {
                // clean unnecessary structure
                trace_tree.out_traces = [];
                return [{total_actions: total_actions, action_idx: action_idx, trace: trace_tree}].concat(corrupted_branch);
            }
        }
        return null;
    }
}

export default Tracing