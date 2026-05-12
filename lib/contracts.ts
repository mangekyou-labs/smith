import { SPARKINFT_ADDRESS } from "./sparkinft-abi";

// Exists to satisfy EVM-era imports from deprecated components.
// Solana-only app: no longer used but kept to avoid breaking build.
export const CONTRACTS = {
  predictionMarket: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  sparkinft: SPARKINFT_ADDRESS,
  wld: "0x0000000000000000000000000000000000000001" as `0x${string}`,
};