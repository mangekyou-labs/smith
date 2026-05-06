import { Connection, PublicKey } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";
import idl from "@/target/idl/smith_oracle.json";

const PROGRAM_ID =
  process.env.NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID ??
  "CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx";

const CLUSTER =
  (process.env.NEXT_PUBLIC_SOLANA_CLUSTER as "devnet" | "mainnet-beta") ??
  "devnet";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  (CLUSTER === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com");

// Market account discriminator — match the on-chain account discriminator
const MARKET_DISCRIMINATOR = Buffer.from([
  219, 190, 213, 55, 0, 227, 198, 154,
]);

export interface MarketAccount {
  pubkey: string;
  marketId: string; // hex string (0x...)
  creator: string; // base58
  questionUri: string;
  status: number; // 0=OPEN, 1=RESOLVED
  minVotes: number;
  consensusBps: number;
  commitDeadline: number; // unix timestamp
  revealDeadline: number; // unix timestamp
  totalCommits: number;
  totalReveals: number;
  yesReveals: number;
  noReveals: number;
  resolvedOutcome: number; // 0=NONE, 1=YES, 2=NO
  yesPool: string; // bigint as string (u64)
  noPool: string; // bigint as string (u64)
  bump: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function marketIdBytesToHex(bytes: Uint8Array): string {
  // Trim trailing zeros (common after borsh encoding of fixed-size array)
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytesToHex(bytes.slice(0, end));
}

// In-memory cache
let cachedMarkets: MarketAccount[] | null = null;
let lastFetch = 0;
const CACHE_TTL_MS = 30_000;

export async function getMarketAccounts(
  connection: Connection
): Promise<MarketAccount[]> {
  const now = Date.now();
  if (cachedMarkets && now - lastFetch < CACHE_TTL_MS) {
    return cachedMarkets;
  }

  try {
    const programId = new PublicKey(PROGRAM_ID);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
const coder = new BorshCoder(idl as any);

    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: MARKET_DISCRIMINATOR.toString("base64"),
          },
        },
      ],
    });

    const markets: MarketAccount[] = [];

    for (const account of accounts) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decoded = coder.accounts.decode("Market", account.account.data) as any;

        const marketIdBytes =
          decoded.marketId instanceof Uint8Array
            ? decoded.marketId
            : Buffer.from(decoded.marketId);

        const yesPool =
          typeof decoded.yesPool === "object" && "toString" in decoded.yesPool
            ? decoded.yesPool.toString()
            : String(decoded.yesPool ?? 0);

        const noPool =
          typeof decoded.noPool === "object" && "toString" in decoded.noPool
            ? decoded.noPool.toString()
            : String(decoded.noPool ?? 0);

        markets.push({
          pubkey: account.pubkey.toBase58(),
          marketId: marketIdBytesToHex(marketIdBytes),
          creator:
            decoded.creator instanceof PublicKey
              ? decoded.creator.toBase58()
              : String(decoded.creator ?? ""),
          questionUri: String(decoded.questionUri ?? ""),
          status: Number(decoded.status ?? 0),
          minVotes: Number(decoded.minVotes ?? 0),
          consensusBps: Number(decoded.consensusBps ?? 0),
          commitDeadline: Number(decoded.commitDeadline ?? 0),
          revealDeadline: Number(decoded.revealDeadline ?? 0),
          totalCommits: Number(decoded.totalCommits ?? 0),
          totalReveals: Number(decoded.totalReveals ?? 0),
          yesReveals: Number(decoded.yesReveals ?? 0),
          noReveals: Number(decoded.noReveals ?? 0),
          resolvedOutcome: Number(decoded.resolvedOutcome ?? 0),
          yesPool,
          noPool,
          bump: Number(decoded.bump ?? 0),
        });
      } catch {
        // Skip malformed accounts
      }
    }

    cachedMarkets = markets;
    lastFetch = now;
    return markets;
  } catch (err) {
    // Return stale cache on error rather than crashing
    if (cachedMarkets) return cachedMarkets;
    throw err;
  }
}

export async function getMarketById(
  connection: Connection,
  marketIdHex: string
): Promise<MarketAccount | null> {
  const markets = await getMarketAccounts(connection);
  return markets.find((m) => m.marketId === marketIdHex) ?? null;
}

export function getMarketPda(marketIdHex: string): PublicKey {
  const normalized = marketIdHex.trim().toLowerCase();
  const hexPart = normalized.startsWith("0x") ? normalized.slice(2) : normalized;
  const marketIdBytes = Buffer.from(hexPart, "hex");
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), marketIdBytes],
    new PublicKey(PROGRAM_ID)
  )[0];
}

export function marketIdHexToBytes(
  marketIdHex: string
): Uint8Array {
  const normalized = marketIdHex.trim().toLowerCase();
  const hexPart = normalized.startsWith("0x") ? normalized.slice(2) : normalized;
  // Pad to 32 bytes (borsh pads the [u8;32] field)
  const bytes = new Uint8Array(32);
  const hexBytes = Buffer.from(hexPart, "hex");
  bytes.set(hexBytes.slice(0, 32), 0);
  return bytes;
}

export { RPC_URL, CLUSTER, PROGRAM_ID };
