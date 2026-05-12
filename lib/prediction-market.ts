import { wagmiConfig } from "./wagmi";

// Exists to satisfy EVM-era imports from deprecated components.
// All actual logic migrated to Solana — this file is a stub.
import type { Abi } from "viem";

export const PREDICTION_MARKET_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
export const PREDICTION_MARKET_ABI: Abi = [];
export const ERC20_ABI: Abi = [];

// Outcome namespace — used as value in legacy EVM components
export const Outcome = { YES: 1, NO: 0 } as const;
export type Outcome = typeof Outcome[keyof typeof Outcome];
export { wagmiConfig };