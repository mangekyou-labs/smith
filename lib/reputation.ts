// Reputation and voting utilities — no external dependencies
import crypto from "crypto";

export interface AgentEntry {
  displayName: string;
  inftTokenId: number | null;
  reputation: number;
  humanId: string | null;
  domainTags: string;
}

export function selectCommittee(agents: AgentEntry[], size: number): AgentEntry[] {
  return [...agents].sort((a, b) => (b.reputation ?? 10) - (a.reputation ?? 10)).slice(0, size);
}

export function updateReputation(_marketId: string, _question: string, consensus: string, votes: { agent: string; vote: string }[]): { agent: string; change: number }[] {
  return votes.map((v) => ({ agent: v.agent, change: v.vote === consensus ? 5 : -3 }));
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

export interface ReputationUpdate {
  agent: string;
  change: number;
}