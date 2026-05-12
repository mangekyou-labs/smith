/**
 * POST /api/commands/solana-bridge
 *
 * M3 Agent Bridge — submits off-chain agent votes to the Solana SMITH_ORACLE program.
 *
 * Accepts the vote results produced by resolve-1 / resolve-2 and writes them
 * on-chain as real commit + reveal transactions.
 *
 * Body:
 *   action: "register_agent" | "create_market" | "place_bet" | "claim_payout"
 *           | "commit" | "reveal" | "resolve" | "settle"
 *   marketIdHex: string          // 32-byte hex market ID (most actions)
 *   agentPubkey: string          // base58 agent account pubkey (vote actions)
 *   round: number                // voting round (1 or 2)
 *
 *   For "register_agent":
 *     name: string
 *     metadataUri: string
 *     humanIdHash: string        // 32-byte hex
 *
 *   For "create_market":
 *     marketId: string           // 32-byte hex
 *     questionUri: string
 *     minVotes: number
 *     consensusBps: number       // e.g. 7000 = 70%
 *     commitDeadline: number     // unix timestamp
 *     revealDeadline: number     // unix timestamp
 *
 *   For "place_bet":
 *     marketId: string           // 32-byte hex
 *     outcome: 1 | 2
 *     amount: number             // base units
 *     mintAddress: string        // base58 SPL mint
 *
 *   For "claim_payout":
 *     marketId: string           // 32-byte hex
 *     mintAddress: string        // base58 SPL mint
 *
 *   For "commit":
 *     commitHashHex: string      // 32-byte hex commit hash
 *
 *   For "reveal":
 *     outcome: 1 | 2             // OUTCOME_YES=1, OUTCOME_NO=2
 *     saltHex: string            // 32-byte hex salt
 *     evidenceHashHex?: string   // optional 32-byte hex evidence hash
 *
 *   For "resolve": (no extra fields — permissionless after reveal_deadline)
 *
 *   For "settle":
 *     voteRecordPubkey: string   // base58 vote record account pubkey
 *     reputationPubkey: string   // base58 reputation account pubkey
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

const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SPL_ASSOCIATED_SPL_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS");

/** Derive the associated token account address for a wallet + mint. */
function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_SPL_TOKEN_PROGRAM_ID
  );
  return ata;
}
import idl from "@/target/idl/smith_oracle.json";
import { registerMarketPda } from "@/lib/solana/market-index";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID ??
    "CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx"
);

const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

function getOperatorKeypair(): Keypair {
  const raw = process.env.SOLANA_OPERATOR_SECRET_KEY;
  if (!raw) throw new Error("SOLANA_OPERATOR_SECRET_KEY not set");
  // Accept either base58 or JSON array
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

  const { action, marketIdHex, agentPubkey, round = 1 } = req.body;

  if (!action) {
    return res.status(400).json({ error: "action is required" });
  }

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
  const program = new Program(idl as any, provider);

  try {
    if (action === "register_agent") {
      const { name, metadataUri, humanIdHash } = req.body;
      if (!name || !metadataUri || !humanIdHash) {
        return res.status(400).json({ error: "name, metadataUri, humanIdHash required" });
      }
      const humanIdBytes = hex32ToBytes(humanIdHash);

      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), keypair.publicKey.toBuffer()],
        PROGRAM_ID
      );
      const [reputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("reputation"), agentPda.toBuffer()],
        PROGRAM_ID
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .registerAgent(name, metadataUri, humanIdBytes)
        .accounts({
          agent: agentPda,
          reputation: reputationPda,
          authority: keypair.publicKey,
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({ success: true, action: "register_agent", signature: sig, agent: agentPda.toBase58(), reputation: reputationPda.toBase58() });
    }

    if (action === "create_market") {
      const { marketId, questionUri, minVotes, consensusBps, commitDeadline, revealDeadline } = req.body;
      if (!marketId || !questionUri || minVotes == null || consensusBps == null || !commitDeadline || !revealDeadline) {
        return res.status(400).json({ error: "marketId, questionUri, minVotes, consensusBps, commitDeadline, revealDeadline required" });
      }
      const idBytes = hex32ToBytes(marketId);

      const [mktPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(idBytes)],
        PROGRAM_ID
      );

      // Build instruction data manually to bypass Anchor SDK simulation bug.
      // Discriminator for create_market: [103, 226, 97, 235, 200, 188, 251, 254]
      const discriminator = Buffer.from([103, 226, 97, 235, 200, 188, 251, 254]);
      const encoder = new TextEncoder();
      const questionUriBytes = encoder.encode(questionUri);
      const questionUriLen = Buffer.alloc(4);
      questionUriLen.writeUInt32LE(questionUriBytes.length, 0);
      const minVotesBuf = Buffer.alloc(2);
      minVotesBuf.writeUInt16LE(Number(minVotes), 0);
      const consensusBpsBuf = Buffer.alloc(2);
      consensusBpsBuf.writeUInt16LE(Number(consensusBps), 0);
      const commitDeadlineBuf = Buffer.alloc(8);
      commitDeadlineBuf.writeBigInt64LE(BigInt(Number(commitDeadline)), 0);
      const revealDeadlineBuf = Buffer.alloc(8);
      revealDeadlineBuf.writeBigInt64LE(BigInt(Number(revealDeadline)), 0);

      const data = Buffer.concat([
        discriminator,
        Buffer.from(idBytes),
        questionUriLen,
        questionUriBytes,
        minVotesBuf,
        consensusBpsBuf,
        commitDeadlineBuf,
        revealDeadlineBuf,
      ]);

      const instruction = {
        keys: [
          { pubkey: mktPda, isSigner: false, isWritable: true },
          { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data,
      };

      const tx = new (await import("@solana/web3.js")).Transaction().add(instruction);
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = keypair.publicKey;
      tx.sign(keypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await connection.confirmTransaction(sig, "confirmed");
      registerMarketPda(mktPda.toBase58());
      return res.json({ success: true, action: "create_market", signature: sig, market: mktPda.toBase58() });
    }

    if (action === "place_bet") {
      const { outcome, amount, mintAddress } = req.body;
      const effectiveMarketIdHex = req.body.marketIdHex ?? req.body.marketId;
      if (!effectiveMarketIdHex || outcome == null || !amount || !mintAddress) {
        return res.status(400).json({ error: "marketIdHex, outcome, amount, mintAddress required" });
      }
      const mint = new PublicKey(mintAddress);
      const bettorAta = await getAssociatedTokenAddress(mint, keypair.publicKey);

      const marketIdBytes = hex32ToBytes(effectiveMarketIdHex);
      const [mktPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdBytes)],
        PROGRAM_ID
      );
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), Buffer.from(marketIdBytes)],
        PROGRAM_ID
      );
      const [betEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet"), mktPda.toBuffer(), keypair.publicKey.toBuffer()],
        PROGRAM_ID
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .placeBet(Number(outcome), new BN(Number(amount)))
        .accounts({
          market: mktPda,
          vault: vaultPda,
          bettorTokenAccount: bettorAta,
          betEscrow: betEscrowPda,
          mint,
          bettor: keypair.publicKey,
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({ success: true, action: "place_bet", signature: sig, betEscrow: betEscrowPda.toBase58() });
    }

    if (action === "claim_payout") {
      const { mintAddress } = req.body;
      const effectiveMarketIdHex = req.body.marketIdHex ?? req.body.marketId;
      if (!effectiveMarketIdHex || !mintAddress) {
        return res.status(400).json({ error: "marketIdHex and mintAddress required" });
      }
      const mint = new PublicKey(mintAddress);
      const bettorAta = await getAssociatedTokenAddress(mint, keypair.publicKey);

      const marketIdBytes = hex32ToBytes(effectiveMarketIdHex);
      const [mktPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdBytes)],
        PROGRAM_ID
      );
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), Buffer.from(marketIdBytes)],
        PROGRAM_ID
      );
      const [betEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet"), mktPda.toBuffer(), keypair.publicKey.toBuffer()],
        PROGRAM_ID
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .claimPayout()
        .accounts({
          market: mktPda,
          vault: vaultPda,
          bettorTokenAccount: bettorAta,
          betEscrow: betEscrowPda,
          mint,
          bettor: keypair.publicKey,
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({ success: true, action: "claim_payout", signature: sig });
    }

    if (action === "commit") {
      const { commitHashHex } = req.body;
      const effectiveMarketIdHex = req.body.marketIdHex ?? req.body.marketId;
      if (!effectiveMarketIdHex || !agentPubkey || !commitHashHex) {
        return res.status(400).json({ error: "agentPubkey and commitHashHex required for commit" });
      }

      const marketIdBytes = hex32ToBytes(effectiveMarketIdHex);
      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdBytes)],
        PROGRAM_ID
      );
      const agentKey = new PublicKey(agentPubkey);
      const commitHashBytes = hex32ToBytes(commitHashHex);

      const [voteRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vote"), marketPda.toBuffer(), agentKey.toBuffer(), Buffer.from([round])],
        PROGRAM_ID
      );

      // Fetch agent to get human_id_hash for the marker PDA
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agentAccount = await (program.account as any).agent.fetch(agentKey);
      const humanIdHash: number[] = Array.from(agentAccount.humanIdHash as Uint8Array);

      const [humanVoteMarkerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("human-vote"), marketPda.toBuffer(), Buffer.from(humanIdHash)],
        PROGRAM_ID
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .commitVote(round, commitHashBytes)
        .accounts({
          market: marketPda,
          agent: agentKey,
          voteRecord: voteRecordPda,
          humanVoteMarker: humanVoteMarkerPda,
          authority: keypair.publicKey,
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({ success: true, action: "commit", signature: sig, voteRecord: voteRecordPda.toBase58() });
    }

    if (action === "reveal") {
      const { outcome, saltHex, evidenceHashHex } = req.body;
      const effectiveMarketIdHex = req.body.marketIdHex ?? req.body.marketId;
      if (!effectiveMarketIdHex || !agentPubkey || outcome == null || !saltHex) {
        return res.status(400).json({ error: "agentPubkey, outcome, and saltHex required for reveal" });
      }

      const marketIdBytes = hex32ToBytes(effectiveMarketIdHex);
      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdBytes)],
        PROGRAM_ID
      );
      const agentKey = new PublicKey(agentPubkey);
      const saltBytes = hex32ToBytes(saltHex);
      const evidenceBytes = evidenceHashHex ? hex32ToBytes(evidenceHashHex) : Array(32).fill(0);

      const [voteRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vote"), marketPda.toBuffer(), agentKey.toBuffer(), Buffer.from([round])],
        PROGRAM_ID
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .revealVote(outcome, saltBytes, evidenceBytes)
        .accounts({
          market: marketPda,
          agent: agentKey,
          voteRecord: voteRecordPda,
          authority: keypair.publicKey,
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({ success: true, action: "reveal", signature: sig });
    }

    if (action === "resolve") {
      const effectiveMarketIdHex = req.body.marketIdHex ?? req.body.marketId;
      if (!effectiveMarketIdHex) {
        return res.status(400).json({ error: "marketIdHex required for resolve" });
      }
      const marketIdBytes = hex32ToBytes(effectiveMarketIdHex);
      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdBytes)],
        PROGRAM_ID
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .resolveMarket()
        .accounts({
          market: marketPda,
          resolver: keypair.publicKey,
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({ success: true, action: "resolve", signature: sig, market: marketPda.toBase58() });
    }

    if (action === "settle") {
      const { voteRecordPubkey, reputationPubkey } = req.body;
      const effectiveMarketIdHex = req.body.marketIdHex ?? req.body.marketId;
      if (!effectiveMarketIdHex || !agentPubkey || !voteRecordPubkey || !reputationPubkey) {
        return res.status(400).json({ error: "agentPubkey, voteRecordPubkey, reputationPubkey required for settle" });
      }
      const marketIdBytes = hex32ToBytes(effectiveMarketIdHex);
      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdBytes)],
        PROGRAM_ID
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .settleReputation()
        .accounts({
          market: marketPda,
          agent: new PublicKey(agentPubkey),
          voteRecord: new PublicKey(voteRecordPubkey),
          reputation: new PublicKey(reputationPubkey),
          authority: keypair.publicKey,
        })
        .transaction();

      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return res.json({ success: true, action: "settle", signature: sig });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }
}
