import { Wallet } from "ethers";
import { ZGComputeNetworkBroker, createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

const LEDGER_CA = "0x5d3D6359d2450d2f23984BaC82C1C561E301aDB8";
const INFERENCE_CA = "0x82cBeaD62b8B978C2A52d43d3b2eA5a8c6Ba6Fa6";

async function createBroker(): Promise<ZGComputeNetworkBroker> {
  const storagePk = process.env.ZG_STORAGE_PRIVATE_KEY;
  if (!storagePk) throw new Error("ZG_STORAGE_PRIVATE_KEY not set");
  const rpcUrl = process.env.ZG_RPC_URL ?? "https://rpc.0gai.com";
  const wallet = new Wallet(storagePk, new (Wallet as any).providers.JsonRpcProvider(rpcUrl));
  return createZGComputeNetworkBroker(wallet, LEDGER_CA, INFERENCE_CA);
}

export interface AgentEntry {
  displayName: string;
  inftTokenId: number | null;
  reputation: number;
  humanId: string | null;
  domainTags: string;
}

export function getMintedAgents(): AgentEntry[] {
  return [];
}

export function selectCommittee(agents: AgentEntry[], size: number): AgentEntry[] {
  return [...agents].sort((a, b) => (b.reputation ?? 10) - (a.reputation ?? 10)).slice(0, size);
}

export function updateReputation(_marketId: string, _question: string, consensus: string, votes: { agent: string; vote: string }[]): { agent: string; change: number }[] {
  return votes.map((v) => ({ agent: v.agent, change: v.vote === consensus ? 5 : -3 }));
}

export function getBaseUrl(_req: { headers: { origin?: string } }): string {
  return "http://localhost:3000";
}

export async function callAgent(_baseUrl: string, tokenId: number | null, prompt: string, userAddress: string, _timeoutMs?: number): Promise<{ response: string }> {
  if (!tokenId) throw new Error("tokenId required for 0G inference");
  const broker = await createBroker();
  // Use requestProcessor directly — the exact API shape depends on SDK version
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (broker.inference as any).requestProcessor.request({
    contractAddress: INFERENCE_CA,
    tokenId,
    message: prompt,
    userAddress,
    maxTokens: 500,
  });
  return { response: result.response ?? JSON.stringify(result) };
}

export async function getWalletAddress(_baseUrl: string): Promise<string> {
  return "0x0000000000000000000000000000000000000000";
}

export function extractVote(text: string): "YES" | "NO" {
  const match = text.match(/My vote:\s*(YES|NO)/i);
  return match?.[1].toUpperCase() === "NO" ? "NO" : "YES";
}

export function generateSolanaSalt(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return "0x" + Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { createBroker };