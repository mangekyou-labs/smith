/**
 * Confidential Market — gRPC counter initialization helpers.
 *
 * Self-contained utilities for:
 * - Mock encryption (encryptValue) for dev/pre-alpha mode
 * - PDA derivation for encrypt CPI accounts
 * - Polling helpers for verification + decryption
 * - FHE type constants
 *
 * gRPC client (createConfidentialMarketClient) requires @protobuf-ts/grpcweb-transport
 * to be installed separately in the project's node_modules. In pre-alpha, the mock
 * encryption path is used instead — real FHE requires the executor network.
 */

import { PublicKey } from "@solana/web3.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const GRPC_URL = "https://pre-alpha-dev-1.encrypt.ika-network.net:443";
export const ENCRYPT_PROGRAM_ID = new PublicKey("4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8");
export const CONFIDENTIAL_MARKET_PROGRAM_ID = new PublicKey("BB17yKcbp9qNyokaNPo29gjFK9aYBEH69wpQgiRPZhwz");

// Network encryption key (32 bytes, all 0x55 in dev — replace in production)
export const NETWORK_KEY = new Uint8Array(32).fill(0x55);

// FHE type constants (match encrypt-types)
export const FHE_BOOL = 0;
export const FHE_UINT64 = 4;

// ── Mock encryption (dev mode only — pre-alpha) ──────────────────────────

/**
 * Client-side mock encryption for dev/pre-alpha.
 *
 * Produces the executor's legacy 17-byte format:
 *   [fhe_type(1) || value_le(16)]
 *
 * The executor reads this and (in pre-alpha mock mode) uses the value directly.
 * In production: WASM FHE encryptor produces real ciphertexts.
 *
 * @param value - Numeric value to encode
 * @param fheType - FHE type constant (FHE_BOOL=0, FHE_UINT64=4, etc.)
 */
export function encryptValue(value: number | bigint, fheType: number): Uint8Array {
  const buf = new Uint8Array(17);
  buf[0] = fheType;
  let v = BigInt(value);
  for (let i = 0; i < 16; i++) {
    buf[1 + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

/**
 * Decode a mock ciphertext back to a number.
 * Only works in pre-alpha mock mode where executor returns plaintext values.
 */
export function decryptValue(ciphertext: Uint8Array): bigint {
  let result = 0n;
  for (let i = 16; i >= 1; i--) {
    result = (result << 8n) | BigInt(ciphertext[i]);
  }
  return result;
}

// ── FHE type helpers ───────────────────────────────────────────────────────

export function isFheBool(fheType: number): boolean {
  return fheType === FHE_BOOL;
}

export function isFheUint64(fheType: number): boolean {
  return fheType === FHE_UINT64;
}

// ── PDA derivations ─────────────────────────────────────────────────────────

/**
 * Derive the CPI authority PDA for the confidential market program.
 * Seed: "__encrypt_cpi_authority"
 *
 * The CPI authority is a PDA that the Encrypt program signs with when
 * executing graphs on behalf of the confidential market program.
 */
export function deriveCpiAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__encrypt_cpi_authority")],
    CONFIDENTIAL_MARKET_PROGRAM_ID
  );
}

/**
 * Derive the encrypt config PDA.
 * Seed: "encrypt_config"
 */
export function deriveEncryptConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("encrypt_config")],
    ENCRYPT_PROGRAM_ID
  );
}

/**
 * Derive the encrypt deposit PDA for a given payer.
 * Seed: "encrypt_deposit" + payer pubkey
 */
export function deriveEncryptDepositPda(payer: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("encrypt_deposit"), payer.toBuffer()],
    ENCRYPT_PROGRAM_ID
  );
}

/**
 * Derive the network encryption key PDA.
 * Seed: "network_encryption_key" + NETWORK_KEY bytes
 */
export function deriveNetworkKeyPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("network_encryption_key"), NETWORK_KEY],
    ENCRYPT_PROGRAM_ID
  );
}

/**
 * Derive the event authority PDA for the Encrypt program.
 * Seed: "__event_authority"
 */
export function deriveEventAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    ENCRYPT_PROGRAM_ID
  );
}

/**
 * Build the full set of Encrypt CPI accounts for a caller program.
 * Returns account metas needed for place_bet, request_bet_decryption, etc.
 */
export function buildEncryptCpiAccounts(
  payer: PublicKey
): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  const [cpiAuthority] = deriveCpiAuthorityPda();
  const [configPda] = deriveEncryptConfigPda();
  const [depositPda] = deriveEncryptDepositPda(payer);
  const [networkKeyPda] = deriveNetworkKeyPda();
  const [eventAuthority] = deriveEventAuthorityPda();

  return [
    { pubkey: ENCRYPT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: depositPda, isSigner: false, isWritable: true },
    { pubkey: cpiAuthority, isSigner: false, isWritable: false },
    { pubkey: CONFIDENTIAL_MARKET_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: networkKeyPda, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
  ];
}

// ── Polling helpers ─────────────────────────────────────────────────────────

interface AccountInfo {
  data: Buffer;
}

/**
 * Poll an account until its status byte indicates VERIFIED (computation done).
 * Status byte at offset 99 in ciphertext account data: 1 = verified.
 *
 * Used after place_bet to wait for cast_vote_graph to finish executing.
 *
 * @param connection - Solana connection with getAccountInfo
 * @param account - PublicKey of the ciphertext account to poll
 * @param timeoutMs - Max wait time (default 120s)
 * @throws Error if timeout reached
 */
export async function pollUntilVerified(
  connection: { getAccountInfo: (pk: PublicKey) => Promise<AccountInfo | null> },
  account: PublicKey,
  timeoutMs = 120_000
): Promise<Buffer> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await connection.getAccountInfo(account);
      if (info && info.data.length >= 100 && info.data[99] === 1) {
        return info.data;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Timeout waiting for account ${account.toBase58()} to verify`);
}

/**
 * Poll a decryption request account until fully decrypted.
 * Decryption complete when bytes_written (offset 103) == total_len (offset 99).
 *
 * Used after request_bet_decryption to wait for the decryptor to respond.
 *
 * @param connection - Solana connection with getAccountInfo
 * @param requestAccount - PublicKey of the decryption request account
 * @param timeoutMs - Max wait time (default 120s)
 * @throws Error if timeout reached
 */
export async function pollUntilDecrypted(
  connection: { getAccountInfo: (pk: PublicKey) => Promise<AccountInfo | null> },
  requestAccount: PublicKey,
  timeoutMs = 120_000
): Promise<Buffer> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await connection.getAccountInfo(requestAccount);
      if (!info) continue;
      const data = info.data;
      if (data.length < 107) continue;
      const total = data.readUInt32LE(99);
      const written = data.readUInt32LE(103);
      if (written === total && total > 0) {
        return data;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Timeout waiting for decryption of ${requestAccount.toBase58()}`);
}

// ── gRPC client (requires external package — see note below) ───────────────

/**
 * ConfidentialMarketClient interface for encrypt gRPC.
 * Implement this with the actual @protobuf-ts/grpcweb-transport client.
 *
 * In pre-alpha dev, the mock encryption path (encryptValue) is used instead.
 * The gRPC path requires:
 *   npm install @protobuf-ts/grpcweb-transport
 * in the project, then use createEncryptWebClient from encrypt-pre-alpha.
 */
export interface ConfidentialMarketClient {
  /**
   * Submit encrypted inputs and receive on-chain ciphertext identifiers.
   * Each input is a mock ciphertext (17-byte [fheType || value_le_16]) in pre-alpha.
   */
  createInput(params: {
    inputs: { ciphertextBytes: Uint8Array; fheType: number }[];
  }): Promise<Uint8Array[]>;
}

/**
 * In-memory mock client for dev/pre-alpha.
 *
 * Simulates gRPC createInput by generating keypairs and returning their pubkeys
 * as ciphertext identifiers. The actual executor isn't called — all computation
 * is simulated locally.
 *
 * Use this for testing the full flow locally without the executor network.
 */
export class MockConfidentialMarketClient implements ConfidentialMarketClient {
  private readonly counter: number;

  constructor(startCounter = 0) {
    this.counter = startCounter;
  }

  async createInput(params: {
    inputs: { ciphertextBytes: Uint8Array; fheType: number }[];
  }): Promise<Uint8Array[]> {
    // Generate a keypair for each input — their pubkey is the "ciphertext identifier"
    // In real usage, these keypairs would be created on-chain as ciphertext accounts
    return params.inputs.map((_, i) => {
      // Derive a pseudo-random pubkey from counter + index
      // Real implementation: new Keypair() and use its publicKey
      const seed = Buffer.alloc(32);
      seed.writeUInt32LE(this.counter + i, 0);
      // Return 32-byte pubkey bytes (placeholder for real keypair pubkey)
      // In dev mode, the first bytes encode the fheType for easy identification
      const result = new Uint8Array(32);
      if (params.inputs[i]?.fheType === FHE_BOOL) {
        result[0] = 0xFF; // marker for bool
      } else {
        result[0] = 0xAA; // marker for uint64
      }
      result[1] = params.inputs[i]?.fheType ?? 0;
      seed.copy(result, 2);
      return result;
    });
  }
}

/**
 * Create the gRPC client (production path).
 *
 * Requires @protobuf-ts/grpcweb-transport to be installed and the generated
 * protobuf files to be built. Falls back to MockConfidentialMarketClient if
 * unavailable — this is the expected path in dev/pre-alpha.
 *
 * In production, use the real client:
 *   import { createEncryptWebClient, Chain } from "@encrypt.xyz/pre-alpha-solana-client/grpc-web";
 *   const client = createEncryptWebClient(GRPC_URL);
 */
export async function createConfidentialMarketClient(): Promise<ConfidentialMarketClient> {
  // In dev/pre-alpha, always use the mock — the executor network isn't available
  // and the generated protobuf files aren't built. The mock path exercises
  // the full API route flow including gRPC createInput → Anchor instruction wiring.
  return new MockConfidentialMarketClient();
}

// ── Helper: Convert Uint8Array to [u8; 32] for Anchor ───────────────────────

/**
 * Convert Uint8Array (from gRPC response) to [u8; 32] for Anchor instruction.
 */
export function u8ArrayToBytes32(arr: Uint8Array): number[] {
  return Array.from(arr.slice(0, 32));
}

/**
 * Convert PublicKey to [u8; 32] bytes for Anchor instruction.
 */
export function pubkeyToBytes32(pk: PublicKey): number[] {
  return Array.from(pk.toBuffer());
}