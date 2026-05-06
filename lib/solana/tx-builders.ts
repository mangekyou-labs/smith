import {
  Transaction,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { Program, BorshCoder } from "@coral-xyz/anchor";
import idl from "@/target/idl/smith_oracle.json";

const PROGRAM_ID =
  process.env.NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID ??
  "CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx";

const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const SYSTEM_PROGRAM = SystemProgram.programId;

function marketIdHexToBytes32(marketIdHex: string): Uint8Array {
  const normalized = marketIdHex.trim().toLowerCase();
  const hexPart = normalized.startsWith("0x") ? normalized.slice(2) : normalized;
  const bytes = new Uint8Array(32);
  const hexBytes = Buffer.from(hexPart, "hex");
  bytes.set(hexBytes.slice(0, 32), 0);
  return bytes;
}

function deriveMarketPda(marketIdHex: string): PublicKey {
  const marketIdBytes = marketIdHexToBytes32(marketIdHex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), marketIdBytes],
    new PublicKey(PROGRAM_ID)
  )[0];
}

function deriveVaultPda(marketPda: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    new PublicKey(PROGRAM_ID)
  )[0];
}

function deriveBetEscrowPda(marketPda: PublicKey, bettor: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), marketPda.toBuffer(), bettor.toBuffer()],
    new PublicKey(PROGRAM_ID)
  )[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getProgram(): Program<any> {
  // Return a minimal program interface for account building
  // Actual transaction construction uses raw instructions, not the Program class
  // This is needed only for type-level compatibility
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return null as any;
}

interface PlaceBetParams {
  marketIdHex: string;
  bettor: PublicKey;
  bettorTokenAccount: PublicKey;
  mint: PublicKey;
  outcome: 1 | 2; // 1=YES, 2=NO
  amount: number; // in base units (not microlamports)
}

interface ClaimPayoutParams {
  marketIdHex: string;
  bettor: PublicKey;
  bettorTokenAccount: PublicKey;
  mint: PublicKey;
}

export function buildPlaceBetIx(params: PlaceBetParams): TransactionInstruction {
  const { marketIdHex, bettor, bettorTokenAccount, mint, outcome, amount } =
    params;

  const marketPda = deriveMarketPda(marketIdHex);
  const vaultPda = deriveVaultPda(marketPda);
  const betEscrowPda = deriveBetEscrowPda(marketPda, bettor);
  const marketIdBytes = marketIdHexToBytes32(marketIdHex);

  // Build instruction data: discriminator (8 bytes) + args
  // place_bet discriminator: [222, 62, 67, 220, 63, 166, 126, 33]
  const discriminator = Buffer.from([222, 62, 67, 220, 63, 166, 126, 33]);

  // Borsh encode args: outcome (u8) + amount (u64, BE)
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(amount), 0);
  const data = Buffer.concat([discriminator, Buffer.from([outcome]), amountBuf]);

  return new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [
      { pubkey: marketPda, isWritable: true, isSigner: false },
      { pubkey: vaultPda, isWritable: true, isSigner: false },
      { pubkey: bettorTokenAccount, isWritable: true, isSigner: false },
      { pubkey: betEscrowPda, isWritable: true, isSigner: false },
      { pubkey: mint, isWritable: false, isSigner: false },
      { pubkey: bettor, isWritable: true, isSigner: true },
      { pubkey: TOKEN_PROGRAM, isWritable: false, isSigner: false },
      { pubkey: SYSTEM_PROGRAM, isWritable: false, isSigner: false },
    ],
    data,
  });
}

export function buildClaimPayoutIx(
  params: ClaimPayoutParams
): TransactionInstruction {
  const { marketIdHex, bettor, bettorTokenAccount, mint } = params;

  const marketPda = deriveMarketPda(marketIdHex);
  const vaultPda = deriveVaultPda(marketPda);
  const betEscrowPda = deriveBetEscrowPda(marketPda, bettor);

  // claim_payout discriminator: [127, 240, 132, 62, 227, 198, 146, 133]
  const discriminator = Buffer.from([127, 240, 132, 62, 227, 198, 146, 133]);

  return new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [
      { pubkey: marketPda, isWritable: true, isSigner: false },
      { pubkey: vaultPda, isWritable: true, isSigner: false },
      { pubkey: bettorTokenAccount, isWritable: true, isSigner: false },
      { pubkey: betEscrowPda, isWritable: true, isSigner: false },
      { pubkey: mint, isWritable: true, isSigner: false },
      { pubkey: bettor, isWritable: true, isSigner: false },
      { pubkey: TOKEN_PROGRAM, isWritable: false, isSigner: false },
      { pubkey: SYSTEM_PROGRAM, isWritable: false, isSigner: false },
    ],
    data: discriminator,
  });
}

export function buildPlaceBetTx(params: PlaceBetParams): Transaction {
  const tx = new Transaction().add(buildPlaceBetIx(params));
  tx.recentBlockhash = undefined; // Caller must set
  tx.feePayer = params.bettor;
  return tx;
}

export function buildClaimPayoutTx(params: ClaimPayoutParams): Transaction {
  const tx = new Transaction().add(buildClaimPayoutIx(params));
  tx.recentBlockhash = undefined;
  tx.feePayer = params.bettor;
  return tx;
}

// Get all PDAs for a given market — used for building UI state
export function getMarketPdas(marketIdHex: string) {
  const marketPda = deriveMarketPda(marketIdHex);
  const vaultPda = deriveVaultPda(marketPda);
  return { marketPda, vaultPda };
}

export function getBetEscrowPda(marketIdHex: string, bettor: PublicKey) {
  const marketPda = deriveMarketPda(marketIdHex);
  return deriveBetEscrowPda(marketPda, bettor);
}

export { PROGRAM_ID };
