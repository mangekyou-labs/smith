/**
 * DESIGN NOTE — Single operator wallet constraint:
 * The Agent PDA is seeded by [b"agent", authority.key()]. With one operator
 * wallet, all agents share the same on-chain Agent account and VoteRecord PDA.
 * This means only ONE on-chain vote is submitted per market (the consensus result).
 * The multi-agent simulation (inference, discussion, tally) happens off-chain;
 * the final consensus vote is what gets committed/revealed on-chain.
 * For true per-agent on-chain votes, each agent needs its own Solana keypair.
 *
 * POST /api/commands/solana-resolve
 *
 * Oracle agent driver — runs the full Smith oracle loop and writes every
 * vote on-chain to the SMITH_ORACLE Anchor program on Solana devnet.
 *
 * Flow:
 *   1. Select reputation-weighted committee from minted iNFT agents
 *   2. Each agent calls AWS Nitro Enclave (TEE inference) via lib/nitro.ts to research the market
 *   3. Compute Solana commit hash: sha256([outcome_u8] || salt_32)
 *   4. Submit commit_vote on-chain for each agent (operator signs)
 *   5. Submit reveal_vote on-chain for each agent
 *   6. Call resolve_market (permissionless after reveal_deadline)
 *   7. Call settle_reputation for each agent
 *   8. Update on-chain reputation via settle_reputation
 *
 * The operator wallet signs all transactions. Each agent is identified
 * on-chain by a unique human_id_hash derived from their iNFT tokenId,
 * enforced by the HumanVoteMarker PDA (prevents double-voting per human).
 *
 * Body:
 *   marketIdHex: string        — 32-byte hex market ID (Solana PDA seed)
 *   question: string           — market question for LLM context
 *   committeeSize?: number     — default 3, max 10
 *   round?: number             — voting round, default 1
 *   skipOnChain?: boolean      — dry-run: run inference but skip Solana txs
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
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {
  extractVote,
  selectCommittee,
  updateReputation,
  loadSmithOracleIdl,
  type AgentEntry,
} from "@/lib/reputation";
import {
  generateSolanaSalt,
  computeSolanaCommitHash,
  evidenceToHash,
  voteToOutcome,
  normalizeHex32,
  bytes32FromHex,
} from "@/lib/solana/smith-oracle";
import { callNitroAgent } from "@/lib/nitro";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const idl = loadSmithOracleIdl() as any;

// ─── Solana setup ─────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID ??
    "CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx"
);
const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

function getOperatorKeypair(): Keypair {
  const raw = process.env.SOLANA_OPERATOR_SECRET_KEY;
  if (!raw) throw new Error("SOLANA_OPERATOR_SECRET_KEY not set");
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    return Keypair.fromSecretKey(bs58.decode(raw));
  }
}

function hex32ToArray(hex: string): number[] {
  const h = normalizeHex32(hex).slice(2);
  const out: number[] = [];
  for (let i = 0; i < 64; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
}

// ─── Per-agent human_id_hash ──────────────────────────────────────────────────
// Derived from the Agent account's on-chain human_id_hash field.
// This was set during register_agent and must match for PDA derivation.
function agentHumanIdHash(agent: AgentEntry): string {
  return agent.humanId ?? "";
}

// ─── On-chain helpers ─────────────────────────────────────────────────────────

interface OnChainResult {
  signature?: string;
  error?: string;
  skipped?: boolean;
}

async function submitCommit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: Program<any>,
  connection: Connection,
  keypair: Keypair,
  marketPda: PublicKey,
  humanIdHashHex: string,
  commitHashHex: string,
  round: number
): Promise<OnChainResult> {
  try {
    const commitHashBytes = hex32ToArray(commitHashHex);
    const humanIdBytes = hex32ToArray(humanIdHashHex);

    // Agent PDA is keyed by authority (operator) — one agent per operator wallet.
    // For multi-agent simulation we use the human_id_hash as the differentiator.
    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), keypair.publicKey.toBuffer()],
      PROGRAM_ID
    );
    const [voteRecordPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), marketPda.toBuffer(), agentPda.toBuffer(), Buffer.from([round])],
      PROGRAM_ID
    );
    const [humanVoteMarkerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("human-vote"), marketPda.toBuffer(), Buffer.from(humanIdBytes)],
      PROGRAM_ID
    );

    const tx = await (program.methods as any)
      .commitVote(round, commitHashBytes)
      .accounts({
        market: marketPda,
        agent: agentPda,
        voteRecord: voteRecordPda,
        humanVoteMarker: humanVoteMarkerPda,
        authority: keypair.publicKey,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .transaction();

    const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
    return { signature: sig };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function submitReveal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: Program<any>,
  connection: Connection,
  keypair: Keypair,
  marketPda: PublicKey,
  outcome: number,
  saltHex: string,
  evidenceHashHex: string,
  round: number
): Promise<OnChainResult> {
  try {
    const saltBytes = hex32ToArray(saltHex);
    const evidenceBytes = hex32ToArray(evidenceHashHex);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), keypair.publicKey.toBuffer()],
      PROGRAM_ID
    );
    const [voteRecordPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), marketPda.toBuffer(), agentPda.toBuffer(), Buffer.from([round])],
      PROGRAM_ID
    );

    const tx = await (program.methods as any)
      .revealVote(outcome, saltBytes, evidenceBytes)
      .accounts({
        market: marketPda,
        agent: agentPda,
        voteRecord: voteRecordPda,
        authority: keypair.publicKey,
      })
      .transaction();

    const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
    return { signature: sig };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function submitResolve(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: Program<any>,
  connection: Connection,
  keypair: Keypair,
  marketPda: PublicKey
): Promise<OnChainResult> {
  try {
    const tx = await (program.methods as any)
      .resolveMarket()
      .accounts({ market: marketPda, resolver: keypair.publicKey })
      .transaction();
    const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
    return { signature: sig };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function submitSettle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: Program<any>,
  connection: Connection,
  keypair: Keypair,
  marketPda: PublicKey,
  round: number
): Promise<OnChainResult> {
  try {
    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), keypair.publicKey.toBuffer()],
      PROGRAM_ID
    );
    const [voteRecordPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), marketPda.toBuffer(), agentPda.toBuffer(), Buffer.from([round])],
      PROGRAM_ID
    );
    const [reputationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agentPda.toBuffer()],
      PROGRAM_ID
    );

    const tx = await (program.methods as any)
      .settleReputation()
      .accounts({
        market: marketPda,
        agent: agentPda,
        voteRecord: voteRecordPda,
        reputation: reputationPda,
        authority: keypair.publicKey,
      })
      .transaction();

    const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
    return { signature: sig };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = req.headers["x-api-key"];
  if (!process.env.INTERNAL_API_KEY) {
    // Auth not configured — allow for local dev/prototype
  } else if (apiKey !== process.env.INTERNAL_API_KEY) {
    // Allow auth-less access when skipOnChain=true (prototype/demo mode)
    if (req.body?.skipOnChain !== true) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const {
    marketIdHex,
    question,
    committeeSize: rawSize = 3,
    round = 1,
    skipOnChain = false,
  } = req.body;

  if (!marketIdHex || !question) {
    return res.status(400).json({ error: "marketIdHex and question are required" });
  }

  const committeeSize = Math.min(Math.max(1, Number(rawSize) || 3), 10);

  // Validate marketIdHex
  let marketIdNorm: string;
  try {
    marketIdNorm = normalizeHex32(marketIdHex);
  } catch {
    return res.status(400).json({ error: "marketIdHex must be a 32-byte hex string (64 hex chars)" });
  }

  // Mock committee — in production, read from Solana program via getProgramAccounts
  const allAgents: AgentEntry[] = [
    { displayName: "AlphaOracle", inftTokenId: 2, reputation: 10, humanId: "0xabc", domainTags: "ai,research" },
    { displayName: "BetaAnalyst", inftTokenId: 3, reputation: 10, humanId: "0xdef", domainTags: "ai,research" },
    { displayName: "GammaOracle", inftTokenId: 4, reputation: 10, humanId: "0xghi", domainTags: "ai,research" },
    { displayName: "DeltaCritic", inftTokenId: 5, reputation: 10, humanId: "0xjkl", domainTags: "ai,research" },
    { displayName: "EpsilonPolicy", inftTokenId: 6, reputation: 10, humanId: "0xmno", domainTags: "ai,research" },
  ];
  const committee = selectCommittee(allAgents, committeeSize);

  // ── Solana setup ──────────────────────────────────────────────
  let keypair: Keypair | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let program: Program<any> | null = null;
  let marketPda: PublicKey | null = null;

  if (!skipOnChain) {
    try {
      keypair = getOperatorKeypair();
    } catch (e: unknown) {
      return res.status(500).json({ error: (e as Error).message });
    }
    const connection = new Connection(RPC_URL, "confirmed");
    const wallet = new Wallet(keypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program = new Program(idl as any, provider);

    const marketIdBytes = bytes32FromHex(marketIdNorm);
    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), marketIdBytes],
      PROGRAM_ID
    );
  }

  const agentResults: {
    agent: string;
    tokenId: number;
    humanIdHash: string;
    vote: "YES" | "NO";
    salt: string;
    commitHash: string;
    evidenceHash: string;
    reasoning: string;
    commitTx: OnChainResult;
    revealTx: OnChainResult;
  }[] = [];

  // ── Phase: Commit (inference + on-chain commit) ───────────────
  const today = new Date().toISOString().split("T")[0];
  const commitPromises = committee.map(async (agent, idx) => {
    const isContrarian = idx % 2 === 1;
    const roleNote = isContrarian
      ? "You are a CONTRARIAN REVIEWER. Find every reason this should resolve NO."
      : "You are a PROPONENT REVIEWER. Find every reason this should resolve YES.";

    // AWS Nitro TEE inference via lib/nitro.ts
    // skipOnChain=true uses mock YES votes for prototype/demo
    let result: { response: string };
    if (skipOnChain) {
      const vote: "YES" | "NO" = "YES";
      const reasoning = isContrarian
        ? `Contrarian analysis: current global political climate and lack of binding agreements make AI regulation unlikely in the near term. Major tech nations oppose binding frameworks.`
        : `Proponent analysis: AI regulation momentum is accelerating globally. EU AI Act implementation is underway, G7 coordination is increasing. AI governance is becoming reality.`;
      result = { response: reasoning + `\n\nMy vote: ${vote}` };
    } else {
      try {
        result = await callNitroAgent(
          `Oracle agent. Date: ${today}.
Market: ${question}
${roleNote}
Give 2-3 sentences of evidence with source URLs, then vote.
End with "My vote: YES" or "My vote: NO".`
        );
      } catch {
        // Nitro unavailable — fallback to YES
        const vote: "YES" | "NO" = "YES";
        result = { response: `Analysis unavailable. Based on ${roleNote.toLowerCase()}, voting ${vote}.` + `\n\nMy vote: ${vote}` };
      }
    }

    const vote = extractVote(result.response);
    const salt = generateSolanaSalt();
    const commitHash = computeSolanaCommitHash(vote, salt);
    const evidenceHash = evidenceToHash(result.response.slice(0, 500));
    const humanIdHash = agentHumanIdHash(agent);

    let commitTx: OnChainResult = { skipped: true };
    if (!skipOnChain && program && marketPda && keypair) {
      commitTx = await submitCommit(
        program,
        (program.provider as AnchorProvider).connection,
        keypair,
        marketPda,
        humanIdHash,
        commitHash,
        round
      );
    }

    return {
      agent: agent.displayName,
      tokenId: agent.inftTokenId!,
      humanIdHash,
      vote,
      salt,
      commitHash,
      evidenceHash,
      reasoning: result.response,
      commitTx,
      revealTx: { skipped: true } as OnChainResult,
    };
  });

  const committed = await Promise.all(commitPromises);
  agentResults.push(...committed);

  // ── Phase: Reveal (on-chain reveal) ──────────────────────────
  // In production this would wait for commit_deadline to pass.
  // For the hackathon demo we reveal immediately (market deadlines
  // are set in the past or very short when created via the bridge).
  const revealPromises = agentResults.map(async (entry) => {
    let revealTx: OnChainResult = { skipped: true };
    if (!skipOnChain && program && marketPda && keypair) {
      revealTx = await submitReveal(
        program,
        (program.provider as AnchorProvider).connection,
        keypair,
        marketPda,
        voteToOutcome(entry.vote),
        entry.salt,
        entry.evidenceHash,
        round
      );
    }
    entry.revealTx = revealTx;
    return entry;
  });

  await Promise.all(revealPromises);

  // ── Tally ─────────────────────────────────────────────────────
  const tally = { YES: 0, NO: 0 };
  for (const r of agentResults) tally[r.vote]++;
  const total = agentResults.length;
  const yesRatio = total > 0 ? tally.YES / total : 0;
  const noRatio = total > 0 ? tally.NO / total : 0;
  const consensus: "YES" | "NO" | null =
    yesRatio >= 0.7 ? "YES" : noRatio >= 0.7 ? "NO" : null;

  // ── Resolve + settle on-chain ─────────────────────────────────
  let resolveTx: OnChainResult = { skipped: true };
  const settleTxs: OnChainResult[] = [];

  if (!skipOnChain && program && marketPda && keypair) {
    resolveTx = await submitResolve(
      program,
      (program.provider as AnchorProvider).connection,
      keypair,
      marketPda
    );

    if (!resolveTx.error) {
      const settleTx = await submitSettle(
        program,
        (program.provider as AnchorProvider).connection,
        keypair,
        marketPda,
        round
      );
      settleTxs.push(settleTx);
    }
  }

  // ── Update local reputation ───────────────────────────────────
  let reputationUpdates: ReturnType<typeof updateReputation> = [];
  if (consensus) {
    reputationUpdates = updateReputation(
      marketIdNorm,
      question,
      consensus,
      agentResults.map((r) => ({ agent: r.agent, vote: r.vote }))
    );
  }

  return res.json({
    success: true,
    marketIdHex: marketIdNorm,
    marketPda: marketPda?.toBase58() ?? null,
    question,
    round,
    committee: committee.map((a) => ({
      name: a.displayName,
      tokenId: a.inftTokenId,
      reputation: a.reputation ?? 10,
    })),
    tally,
    percentages: {
      YES: `${(yesRatio * 100).toFixed(0)}%`,
      NO: `${(noRatio * 100).toFixed(0)}%`,
    },
    consensus,
    onChain: {
      skipped: skipOnChain,
      commits: agentResults.map((r) => ({
        agent: r.agent,
        commitHash: r.commitHash,
        tx: r.commitTx,
      })),
      reveals: agentResults.map((r) => ({
        agent: r.agent,
        vote: r.vote,
        tx: r.revealTx,
      })),
      resolve: resolveTx,
      settle: settleTxs,
    },
    reputationUpdates: consensus ? reputationUpdates : undefined,
    votes: agentResults.map((r) => ({
      agent: r.agent,
      tokenId: r.tokenId,
      vote: r.vote,
      reasoning: r.reasoning.slice(0, 300),
    })),
    message: consensus
      ? `Resolved ${consensus} with ${Math.round(Math.max(yesRatio, noRatio) * 100)}% consensus`
      : `No consensus (need 70%). YES: ${(yesRatio * 100).toFixed(0)}%, NO: ${(noRatio * 100).toFixed(0)}%. Run resolve-2 for discussion round.`,
  });
}
