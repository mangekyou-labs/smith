import { Connection, PublicKey } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";

// IDL loaded at build time via require — smith_oracle.json is committed to lib/solana/
// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require("./smith_oracle.json");

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

// Market account discriminator
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

// Known market PDA addresses (populated from create_market API responses)
// In production this would be replaced by a proper indexer
const KNOWN_MARKET_PDAS = new Set<string>([
  "48Pxc7Mg5xkWsbyEaEjLVdvCgB9KNZAo2ER4rcdJuidB", // BTC exceed $100k
  "G12WPS4i9UWn7qkgh8VJXPAQGkB7yPF4ub3ewEHPbX3p", // SOL DeFi TVL
  "4mcPozgjP9sgDCj4d6CipfE5NeYAKnvMhonmYzsw18db", // ETH flip
]);

export function registerMarketPda(pda: string) {
  KNOWN_MARKET_PDAS.add(pda);
}

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

    const markets: MarketAccount[] = [];

    // Strategy 1: Query known market PDAs directly
    if (KNOWN_MARKET_PDAS.size > 0) {
      for (const pdaStr of KNOWN_MARKET_PDAS) {
        try {
          const pda = new PublicKey(pdaStr);
          const info = await connection.getAccountInfo(pda);
          if (info) {
            let data: Buffer;
            if (Buffer.isBuffer(info.data)) {
              data = info.data;
            } else if (typeof info.data === "string") {
              data = Buffer.from(info.data, "base64");
            } else if (Array.isArray(info.data)) {
              data = Buffer.from(info.data[0], "base64");
            } else {
              data = Buffer.from(info.data as string, "base64");
            }
            const market = decodeMarketAccount(coder, data, pdaStr);
            if (market) markets.push(market);
          } else {
            // Skip accounts with no info
          }
        } catch (e: unknown) {
          // Skip invalid PDAs
        }
      }
    }

    // Strategy 2: getProgramAccounts scan (for environments where PDA list is empty)
    // Note: This may return 0 on some devnet RPCs due to Solana bug.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await connection.getProgramAccounts(programId, {
      encoding: "base64",
    }).catch(() => ({ length: 0 })) as { pubkey: { toBase58(): string }; account: { data: string | [string, string] | number[] } }[];

    for (const account of accounts) {
      if (markets.some((m) => m.pubkey === account.pubkey.toBase58())) continue;
      try {
        let rawData: Buffer;
        if (Array.isArray(account.account.data)) {
          // Plain array of numbers (e.g. from Infura)
          rawData = Buffer.from(account.account.data as number[]);
        } else if (typeof account.account.data === "string") {
          rawData = Buffer.from(account.account.data, "base64");
        } else {
          // [base64String, encoding] tuple
          rawData = Buffer.from(account.account.data[0], "base64");
        }

        // Client-side discriminator check
        if (
          rawData.length >= 8 &&
          rawData.slice(0, 8).equals(MARKET_DISCRIMINATOR)
        ) {
          const market = decodeMarketAccount(
            coder,
            rawData,
            account.pubkey.toBase58()
          );
          if (market) markets.push(market);
        }
      } catch {
        // Skip malformed accounts
      }
    }

    cachedMarkets = markets;
    lastFetch = now;
    return markets;
  } catch (err) {
    if (cachedMarkets) return cachedMarkets;
    throw err;
  }
}

function decodeMarketAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coder: any,
  data: Buffer,
  pubkey: string
): MarketAccount | null {
  try {
    const decoded = coder.accounts.decode("Market", data);

    const marketIdBytes =
      decoded.market_id instanceof Uint8Array
        ? decoded.market_id
        : Buffer.from(decoded.market_id);

    const yesPool =
      typeof decoded.yes_pool === "object" && "toString" in decoded.yes_pool
        ? decoded.yes_pool.toString()
        : String(decoded.yes_pool ?? 0);

    const noPool =
      typeof decoded.no_pool === "object" && "toString" in decoded.no_pool
        ? decoded.no_pool.toString()
        : String(decoded.no_pool ?? 0);

    return {
      pubkey,
      marketId: marketIdBytesToHex(marketIdBytes),
      creator:
        decoded.creator instanceof PublicKey
          ? decoded.creator.toBase58()
          : String(decoded.creator ?? ""),
      questionUri: String(decoded.question_uri ?? ""),
      status: Number(decoded.status ?? 0),
      minVotes: Number(decoded.min_votes ?? 0),
      consensusBps: Number(decoded.consensus_bps ?? 0),
      commitDeadline: Number(decoded.commit_deadline ?? 0),
      revealDeadline: Number(decoded.reveal_deadline ?? 0),
      totalCommits: Number(decoded.total_commits ?? 0),
      totalReveals: Number(decoded.total_reveals ?? 0),
      yesReveals: Number(decoded.yes_reveals ?? 0),
      noReveals: Number(decoded.no_reveals ?? 0),
      resolvedOutcome: Number(decoded.resolved_outcome ?? 0),
      yesPool,
      noPool,
      bump: Number(decoded.bump ?? 0),
    };
  } catch {
    return null;
  }
}

export async function getMarketById(
  connection: Connection,
  marketIdHex: string
): Promise<MarketAccount | null> {
  const markets = await getMarketAccounts(connection);
  return (
    markets.find(
      (m) => m.marketId.toLowerCase() === marketIdHex.toLowerCase()
    ) ?? null
  );
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

export function marketIdHexToBytes(marketIdHex: string): Uint8Array {
  const normalized = marketIdHex.trim().toLowerCase();
  const hexPart = normalized.startsWith("0x") ? normalized.slice(2) : normalized;
  const bytes = new Uint8Array(32);
  const hexBytes = Buffer.from(hexPart, "hex");
  bytes.set(hexBytes.slice(0, 32), 0);
  return bytes;
}

export { RPC_URL, CLUSTER, PROGRAM_ID };
