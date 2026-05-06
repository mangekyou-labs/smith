import { createHash, randomBytes } from "crypto";

export type BinaryVote = "YES" | "NO";

export const SMITH_ORACLE_PROGRAM_ID =
  process.env.NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID ??
  "CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx";

export const SolanaOutcome = {
  NONE: 0,
  YES: 1,
  NO: 2,
} as const;

export function voteToOutcome(vote: BinaryVote): number {
  return vote === "YES" ? SolanaOutcome.YES : SolanaOutcome.NO;
}

export function outcomeToVote(outcome: number): BinaryVote {
  if (outcome === SolanaOutcome.YES) return "YES";
  if (outcome === SolanaOutcome.NO) return "NO";
  throw new Error(`Unsupported Solana oracle outcome: ${outcome}`);
}

export function generateSolanaSalt(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

export function marketIdToBytes32(marketId: string): string {
  return sha256Hex(Buffer.from(marketId, "utf8"));
}

export function humanIdToHash(humanId: string): string {
  return sha256Hex(Buffer.from(humanId.toLowerCase(), "utf8"));
}

export function evidenceToHash(evidence: string): string {
  return sha256Hex(Buffer.from(evidence, "utf8"));
}

export function computeSolanaCommitHash(vote: BinaryVote, saltHex: string): string {
  const salt = bytes32FromHex(saltHex);
  return sha256Hex(Buffer.concat([Buffer.from([voteToOutcome(vote)]), salt]));
}

export function verifySolanaCommitHash(
  vote: BinaryVote,
  saltHex: string,
  commitHashHex: string
): boolean {
  return (
    normalizeHex32(computeSolanaCommitHash(vote, saltHex)) ===
    normalizeHex32(commitHashHex)
  );
}

export function bytes32FromHex(value: string): Buffer {
  const normalized = normalizeHex32(value);
  return Buffer.from(normalized.slice(2), "hex");
}

export function normalizeHex32(value: string): `0x${string}` {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Expected 32-byte hex string");
  }
  return normalized.toLowerCase() as `0x${string}`;
}

function sha256Hex(data: Buffer): `0x${string}` {
  return `0x${createHash("sha256").update(data).digest("hex")}`;
}

// ─── Escrow / payout helpers ─────────────────────────────────────────────────

/** Seeds for the vault token account PDA: ["vault", market_id_bytes] */
export function vaultSeeds(marketIdHex: string): [Buffer, Buffer] {
  return [Buffer.from("vault"), bytes32FromHex(marketIdHex)];
}

/** Seeds for a BetEscrow PDA: ["bet", market_pubkey_bytes, bettor_pubkey_bytes] */
export function betEscrowSeeds(
  marketPubkeyBytes: Buffer,
  bettorPubkeyBytes: Buffer
): [Buffer, Buffer, Buffer] {
  return [Buffer.from("bet"), marketPubkeyBytes, bettorPubkeyBytes];
}

/**
 * Compute the proportional payout for a winning bet.
 * Mirrors the on-chain arithmetic: payout = betAmount * totalPool / winningPool
 */
export function computePayout(
  betAmount: bigint,
  yesPool: bigint,
  noPool: bigint,
  resolvedOutcome: number
): bigint {
  const totalPool = yesPool + noPool;
  const winningPool =
    resolvedOutcome === SolanaOutcome.YES ? yesPool : noPool;
  if (winningPool === BigInt(0)) throw new Error("Winning pool is zero");
  return (betAmount * totalPool) / winningPool;
}
