// ERC-7857 iNFT contract on 0G Galileo Testnet (chain 16602)
// SuperpsAgents: 0xC977ABf5F9c529C39dac9306998eC130439150c0

export const ZERO_G_TESTNET = {
  id: 16602,
  name: "0G Galileo Testnet",
  network: "0g-galileo-testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evmrpc-testnet.0g.ai"] },
    public: { http: ["https://evmrpc-testnet.0g.ai"] },
  },
  blockExplorers: {
    default: { name: "0G Explorer", url: "https://chainscan-galileo.0g.ai" },
  },
} as const;

export const SUPERPS_AGENTS_ADDRESS = "0xC977ABf5F9c529C39dac9306998eC130439150c0" as const;
export const MOCK_VERIFIER_ADDRESS = "0x999F07992E85C911b45e2DFfB6A56809dB1bEeb9" as const;

export interface AgentProfile {
  botId: string;
  domainTags: string;
  serviceOfferings: string;
  createdAt: bigint;
  updatedAt: bigint;
  cronSchedule: string;
  cronPrompt: string;
  cronEnabled: boolean;
  executor: string;
  lastExecution: bigint;
  executionCount: bigint;
  x402Wallet: string;
}

export const SUPERPS_AGENTS_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalMinted",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "getAgentProfile",
    outputs: [
      {
        components: [
          { internalType: "string", name: "botId", type: "string" },
          { internalType: "string", name: "domainTags", type: "string" },
          { internalType: "string", name: "serviceOfferings", type: "string" },
          { internalType: "uint256", name: "createdAt", type: "uint256" },
          { internalType: "uint256", name: "updatedAt", type: "uint256" },
          { internalType: "string", name: "cronSchedule", type: "string" },
          { internalType: "string", name: "cronPrompt", type: "string" },
          { internalType: "bool", name: "cronEnabled", type: "bool" },
          { internalType: "address", name: "executor", type: "address" },
          { internalType: "uint256", name: "lastExecution", type: "uint256" },
          { internalType: "uint256", name: "executionCount", type: "uint256" },
          { internalType: "address", name: "x402Wallet", type: "address" },
        ],
        internalType: "struct AgentProfile",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "owner", type: "address" },
      { indexed: false, internalType: "string", name: "botId", type: "string" },
    ],
    name: "AgentMinted",
    type: "event",
  },
] as const;

import { createPublicClient, http } from "viem";

export const zeroGPublicClient = createPublicClient({
  chain: ZERO_G_TESTNET,
  transport: http("https://evmrpc-testnet.0g.ai"),
});

export function format0GExplorerLink(type: "tx" | "address" | "token", hash: string): string {
  return `https://chainscan-galileo.0g.ai/${type}/${hash}`;
}
