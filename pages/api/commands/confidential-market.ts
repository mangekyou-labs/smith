/**
 * POST /api/commands/confidential-market
 *
 * Wires gRPC counter init into confidential_market instructions:
 * - create_market: initializes encrypted yes/no pool counters via gRPC
 * - place_bet: encrypts bet + vote, calls cast_vote_graph CPI
 * - request_payout_decryption: computes FHE payout, requests decryption
 * - claim_payout: verifies decrypted payout, transfers from vault
 *
 * Auth: x-api-key header must match INTERNAL_API_KEY
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {
  createConfidentialMarketClient,
  encryptValue,
  FHE_UINT64,
  FHE_BOOL,
  CONFIDENTIAL_MARKET_PROGRAM_ID,
  ENCRYPT_PROGRAM_ID,
} from "@/lib/solana/encrypt-grpc";

import conf_idl from "@/target/idl/confidential_market.json";

const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

function getOperatorKeypair(): Keypair {
  const raw = process.env.SOLANA_OPERATOR_SECRET_KEY;
  if (!raw) throw new Error("SOLANA_OPERATOR_SECRET_KEY not set");
  try {
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    return Keypair.fromSecretKey(bs58.decode(raw));
  }
}

function hex32ToBytes(hex: string): number[] {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length !== 64) throw new Error(`Expected 32-byte hex, got ${normalized.length / 2} bytes`);
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) {
    bytes.push(parseInt(normalized.slice(i, i + 2), 16));
  }
  return bytes;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = req.headers["x-api-key"];
  if (!process.env.INTERNAL_API_KEY || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { action } = req.body;
  if (!action) return res.status(400).json({ error: "action is required" });

  let keypair: Keypair;
  try {
    keypair = getOperatorKeypair();
  } catch (e: unknown) {
    return res.status(500).json({ error: (e as Error).message });
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(conf_idl as any, provider);

  try {
    // ── create_market ────────────────────────────────────────────────────────
    if (action === "create_market") {
      const {
        marketId,
        title,
        description,
        minVotes,
        consensusBps,
        commitDeadline,
        revealDeadline,
      } = req.body;

      if (
        !marketId || !title || !description ||
        minVotes == null || consensusBps == null ||
        !commitDeadline || !revealDeadline
      ) {
        return res.status(400).json({
          error: "marketId, title, description, minVotes, consensusBps, commitDeadline, revealDeadline required",
        });
      }

      const idBytes = hex32ToBytes(marketId);

      // 1. Initialize encrypted counters via gRPC
      const client = await createConfidentialMarketClient();
      const counters = await client.createInput({
        inputs: [
          { ciphertextBytes: encryptValue(0, FHE_UINT64), fheType: FHE_UINT64 },
          { ciphertextBytes: encryptValue(0, FHE_UINT64), fheType: FHE_UINT64 },
        ],
      });

      if (counters.length < 2) {
        return res.status(500).json({ error: "Failed to create encrypted counters" });
      }

      // MockConfidentialMarketClient returns pubkey-like bytes for each counter
      // Real executor returns actual ciphertext account pubkeys
      const initialYesPoolId = Array.from(counters[0].slice(0, 32));
      const initialNoPoolId = Array.from(counters[1].slice(0, 32));

      // 2. Derive market PDA
      const [mktPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(idBytes)],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      // 3. Build createMarket instruction
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .createMarket(
          idBytes,
          title,
          description,
          Number(minVotes),
          Number(consensusBps),
          new BN(Number(commitDeadline)),
          new BN(Number(revealDeadline)),
          initialYesPoolId,
          initialNoPoolId,
        )
        .accounts({
          market: mktPda,
          creator: keypair.publicKey,
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({
        success: true,
        action: "create_market",
        signature: sig,
        market: mktPda.toBase58(),
        initialYesPoolId: Buffer.from(initialYesPoolId).toString("hex"),
        initialNoPoolId: Buffer.from(initialNoPoolId).toString("hex"),
      });
    }

    // ── place_bet ────────────────────────────────────────────────────────────
    if (action === "place_bet") {
      const { marketIdHex, outcome, amount, mintAddress } = req.body;
      if (!marketIdHex || outcome == null || !amount || !mintAddress) {
        return res.status(400).json({
          error: "marketIdHex, outcome, amount, mintAddress required",
        });
      }

      const marketIdBytes = hex32ToBytes(marketIdHex);
      const [mktPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdBytes)],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      // Encrypt bet amount (EUint64) and vote (EBool) locally
      const betCt = encryptValue(Number(amount), FHE_UINT64);
      const voteCt = encryptValue(outcome === 1 ? 1 : 0, FHE_BOOL);

      // Mock: use first 32 bytes of encrypted values as ciphertext IDs
      // Real: gRPC createInput returns pubkey identifiers for each ciphertext
      const client = await createConfidentialMarketClient();
      const [betCtResult, voteCtResult] = await client.createInput({
        inputs: [
          { ciphertextBytes: betCt, fheType: FHE_UINT64 },
          { ciphertextBytes: voteCt, fheType: FHE_BOOL },
        ],
      });

      const betCtId = Array.from(betCtResult.slice(0, 32));
      // vote_ct is an UncheckedAccount — caller provides the ciphertext account pubkey
      const voteCtId = Array.from(voteCtResult.slice(0, 32));
      const voteCtPda = new PublicKey(voteCtId);

      // Derive PDAs
      const [yesPoolCtPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_pool_ct"), mktPda.toBuffer()],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );
      const [noPoolCtPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_pool_ct"), mktPda.toBuffer()],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );
      const [betEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet"), mktPda.toBuffer(), keypair.publicKey.toBuffer()],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      const mint = new PublicKey(mintAddress);
      const [bettorAta] = PublicKey.findProgramAddressSync(
        [
          keypair.publicKey.toBuffer(),
          new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS")
      );

      const [cpiAuthority, cpiAuthorityBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("__encrypt_cpi_authority")],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .placeBet(
          Number(outcome),
          betCtId,
          voteCtId,
          cpiAuthorityBump,
        )
        .accounts({
          market: mktPda,
          yesPoolCt: yesPoolCtPda,
          noPoolCt: noPoolCtPda,
          voteCt: voteCtPda,
          betEscrow: betEscrowPda,
          bettorTokenAccount: bettorAta,
          mint,
          bettor: keypair.publicKey,
          encryptProgram: ENCRYPT_PROGRAM_ID,
          config: PublicKey.findProgramAddressSync(
            [Buffer.from("encrypt_config")],
            ENCRYPT_PROGRAM_ID
          )[0],
          deposit: PublicKey.findProgramAddressSync(
            [Buffer.from("encrypt_deposit"), keypair.publicKey.toBuffer()],
            ENCRYPT_PROGRAM_ID
          )[0],
          cpiAuthority: cpiAuthority,
          callerProgram: CONFIDENTIAL_MARKET_PROGRAM_ID,
          networkEncryptionKey: PublicKey.findProgramAddressSync(
            [Buffer.from("network_encryption_key"), new Uint8Array(32).fill(0x55)],
            ENCRYPT_PROGRAM_ID
          )[0],
          payer: keypair.publicKey,
          eventAuthority: PublicKey.findProgramAddressSync(
            [Buffer.from("__event_authority")],
            ENCRYPT_PROGRAM_ID
          )[0],
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({
        success: true,
        action: "place_bet",
        signature: sig,
        betEscrow: betEscrowPda.toBase58(),
      });
    }

    // ── request_payout_decryption ──────────────────────────────────────────────
    if (action === "request_payout_decryption") {
      const { marketIdHex } = req.body;
      if (!marketIdHex) {
        return res.status(400).json({ error: "marketIdHex required" });
      }

      const marketIdBytes = hex32ToBytes(marketIdHex);
      const [mktPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdBytes)],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      const [betEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet"), mktPda.toBuffer(), keypair.publicKey.toBuffer()],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      // Derive payout_ct PDA for the computed payout result
      const [payoutCtPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("payout_ct"), mktPda.toBuffer(), keypair.publicKey.toBuffer()],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      const [cpiAuthority, cpiAuthorityBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("__encrypt_cpi_authority")],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .requestPayoutDecryption(cpiAuthorityBump)
        .accounts({
          market: mktPda,
          betEscrow: betEscrowPda,
          requestAcct: new PublicKey("11111111111111111111111111111111"), // placeholder — executor creates this
          payoutCt: payoutCtPda,
          betCt: new PublicKey("11111111111111111111111111111111"), // placeholder
          yesPoolCt: new PublicKey("11111111111111111111111111111111"), // placeholder
          noPoolCt: new PublicKey("11111111111111111111111111111111"), // placeholder
          encryptProgram: ENCRYPT_PROGRAM_ID,
          config: PublicKey.findProgramAddressSync(
            [Buffer.from("encrypt_config")],
            ENCRYPT_PROGRAM_ID
          )[0],
          deposit: PublicKey.findProgramAddressSync(
            [Buffer.from("encrypt_deposit"), keypair.publicKey.toBuffer()],
            ENCRYPT_PROGRAM_ID
          )[0],
          cpiAuthority: cpiAuthority,
          callerProgram: CONFIDENTIAL_MARKET_PROGRAM_ID,
          networkEncryptionKey: PublicKey.findProgramAddressSync(
            [Buffer.from("network_encryption_key"), new Uint8Array(32).fill(0x55)],
            ENCRYPT_PROGRAM_ID
          )[0],
          payer: keypair.publicKey,
          eventAuthority: PublicKey.findProgramAddressSync(
            [Buffer.from("__event_authority")],
            ENCRYPT_PROGRAM_ID
          )[0],
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({
        success: true,
        action: "request_payout_decryption",
        signature: sig,
        payoutCt: payoutCtPda.toBase58(),
      });
    }

    // ── claim_payout ─────────────────────────────────────────────────────────
    if (action === "claim_payout") {
      const { marketIdHex, mintAddress } = req.body;
      if (!marketIdHex || !mintAddress) {
        return res.status(400).json({
          error: "marketIdHex, mintAddress required",
        });
      }

      const marketIdBytes = hex32ToBytes(marketIdHex);
      const [mktPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdBytes)],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      const [betEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet"), mktPda.toBuffer(), keypair.publicKey.toBuffer()],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), Buffer.from(marketIdBytes)],
        CONFIDENTIAL_MARKET_PROGRAM_ID
      );

      const mint = new PublicKey(mintAddress);
      const [bettorAta] = PublicKey.findProgramAddressSync(
        [
          keypair.publicKey.toBuffer(),
          new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS")
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .claimPayout()
        .accounts({
          market: mktPda,
          vault: vaultPda,
          bettorTokenAccount: bettorAta,
          betEscrow: betEscrowPda,
          requestAcct: new PublicKey("11111111111111111111111111111111"), // placeholder — decryption result
          mint,
          bettor: keypair.publicKey,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({
        success: true,
        action: "claim_payout",
        signature: sig,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[confidential-market]", msg);
    return res.status(500).json({ error: msg });
  }
}