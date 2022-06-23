import { Locklift } from "locklift";

class Context {
    locklift: Locklift;
    contracts_map: {[name:string]: any;};

    constructor(locklift: Locklift) {
        this.locklift = locklift;
        this.contracts_map = {}
    }

    addContract(address: string | number, contract: any) {
        this.contracts_map[address] = contract;
    }

    getContract(address: string) {
        if (Object.keys(this.contracts_map).indexOf(address) === -1) {
            return null;
        }
        return this.contracts_map[address]
    }

    getContext() {
        return this.contracts_map;
    }
}

export default Context;