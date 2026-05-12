"use client";
import { useMutation } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { buildClaimPayoutIx, getBetEscrowPda } from "@/lib/solana/tx-builders";
import { SOLANA_RPC_URL } from "@/lib/solana/useMarkets";
import idl from "@/target/idl/smith_oracle.json";

const PROGRAM_ID =
  process.env.NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID ??
  "CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx";

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

// Wrapper that implements Anchor Wallet interface using wallet-adapter
class WalletAdapterWallet {
  publicKey: PublicKey;
  constructor(
    publicKey: PublicKey,
    // Accept broader wallet-adapter signTransaction type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signTransactionFn: any
  ) {
    this.publicKey = publicKey;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async signTransaction(tx: any): Promise<any> {
    return (this as unknown as { signTransactionFn: (tx: any) => Promise<any> }).signTransactionFn(tx);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async signAllTransactions(txs: any[]): Promise<any[]> {
    const fn = (this as unknown as { signTransactionFn: (tx: any) => Promise<any> }).signTransactionFn;
    return Promise.all(txs.map((tx) => fn(tx)));
  }
}

export type BetTxState = "idle" | "pending" | "confirmed" | "finalized" | "error";

export interface BetTxResult {
  signature: string;
  state: BetTxState;
  error?: string;
}

export function usePlaceBet(onSubmitted?: (sig: string) => void) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  return useMutation({
    mutationFn: async ({
      marketIdHex,
      outcome,
      amount,
      bettorTokenAccount,
      mint,
    }: {
      marketIdHex: string;
      outcome: 1 | 2;
      amount: number;
      bettorTokenAccount: PublicKey;
      mint: PublicKey;
    }): Promise<BetTxResult> => {
      if (!publicKey || !signTransaction) throw new Error("Wallet not connected");

      const wallet = new WalletAdapterWallet(publicKey, signTransaction) as unknown as Wallet;
      const provider = new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const program = new Program(idl as any, provider);

      const marketPda = deriveMarketPda(marketIdHex);
      const vaultPda = deriveVaultPda(marketPda);
      const betEscrowPda = getBetEscrowPda(marketIdHex, publicKey);

      const tx = await program.methods
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .placeBet(outcome, new BN(amount) as any)
        .accounts({
          market: marketPda,
          vault: vaultPda,
          bettorTokenAccount,
          betEscrow: betEscrowPda,
          mint,
          bettor: publicKey,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        } as any)
        .transaction();

      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = publicKey;

      const signed = await signTransaction(tx);
      // Send via connection directly since sendTransaction may not have all anchors'
      // signing requirements satisfied by the adapter
      const signature = await connection.sendRawTransaction(signed.serialize());

      // Notify immediately when submitted
      onSubmitted?.(signature);

      try {
        await connection.confirmTransaction(signature, "confirmed");
        return { signature, state: "confirmed" as BetTxState };
      } catch (e) {
        return {
          signature,
          state: "error",
          error: e instanceof Error ? e.message : "Transaction failed",
        };
      }
    },
  });
}

export function useClaimPayout() {
  const { publicKey, sendTransaction } = useWallet();

  return useMutation({
    mutationFn: async ({
      marketIdHex,
      bettorTokenAccount,
      mint,
    }: {
      marketIdHex: string;
      bettorTokenAccount: PublicKey;
      mint: PublicKey;
    }): Promise<BetTxResult> => {
      if (!publicKey) throw new Error("Wallet not connected");

      const connection = new Connection(SOLANA_RPC_URL, "confirmed");

      const ix = buildClaimPayoutIx({
        marketIdHex,
        bettor: publicKey,
        bettorTokenAccount,
        mint,
      });

      const tx = new Transaction().add(ix);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = publicKey;

      const signature = await sendTransaction(tx, connection);
      try {
        await connection.confirmTransaction(signature, "confirmed");
        return { signature, state: "confirmed" as BetTxState };
      } catch (e) {
        return {
          signature,
          state: "error",
          error: e instanceof Error ? e.message : "Transaction failed",
        };
      }
    },
  });
}
