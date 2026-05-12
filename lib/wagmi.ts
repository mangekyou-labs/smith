// wagmi config — exists to satisfy EVM-era imports.
// Solana-only app: no longer used but kept to avoid breaking build.
import { http, createConfig } from "wagmi";
import { defineChain } from "viem";

export const zgTestnet = defineChain({
  id: 16600,
  name: "0G Galileo",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evmrpc-testnet.0g.ai"] },
  },
  blockExplorers: {
    default: { name: "Galileo", url: "https://chainscan-galileo.0g.ai" },
  },
});

export const wagmiConfig = createConfig({
  chains: [zgTestnet],
  transports: { [zgTestnet.id]: http() },
});

export { createConfig, http };