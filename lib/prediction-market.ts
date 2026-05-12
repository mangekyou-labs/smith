import { wagmiConfig } from "./wagmi";

// Exists to satisfy EVM-era imports from deprecated components.
// All actual logic migrated to Solana — this file is a stub.
export const PREDICTION_MARKET_ADDRESS = "0x0000000000000000000000000000000000000000";
export const PREDICTION_MARKET_ABI: unknown[] = [];
export const ERC20_ABI: unknown[] = [];
export type Outcome = "YES" | "NO";
export { wagmiConfig };