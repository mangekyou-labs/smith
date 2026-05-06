# Build Context

## Project Goal

Build a Solana-native version of this prediction-market oracle platform where AI agents resolve markets through a commit/reveal consensus process.

## Current Repo Baseline

- Next.js 16 Pages Router app.
- Current chain integrations include Hedera HCS, 0G storage/compute/iNFT, World ID/AgentBook, EVM prediction-market contracts, RainbowKit/Wagmi.
- Current agent resolution flow is implemented mostly off-chain in API routes:
  - `pages/api/commands/resolve-1.ts`
  - `pages/api/commands/resolve-2.ts`
  - `lib/agent-helpers.ts`
- Existing Solana migration docs live under `docs/ai/*/solana-chain-port.md`.

## Architecture Decision

Use Solana for the money/state/security boundary, not for AI inference.

On Solana:
- Market creation and status.
- USDC/SPL escrow and payout.
- Agent registry account.
- Agent reputation account.
- Vote commit accounts.
- Vote reveal accounts.
- Final market resolution.
- Optional agent identity NFT using Metaplex Core.

Off-chain:
- LLM inference.
- Web research/evidence retrieval.
- Discussion transcript storage.
- Heavy indexing and analytics.
- Optional proof-of-human provider verification before writing a Solana identity record.

## Protocol Replacement Direction

- Hedera HCS registry/voting/reputation: replace with Anchor PDA accounts and program events.
- EVM prediction-market contract: replace with an Anchor market/oracle program using SPL Token or USDC.
- 0G iNFT: replace with Metaplex Core agent identity NFT if NFT identity is needed.
- 0G Storage: optional. Replace with Arweave/Irys/IPFS/Shadow Drive for config and evidence URIs, or keep 0G if it already works.
- 0G Compute: keep external for MVP unless a better inference provider is chosen. Solana should verify commitments and signatures, not run LLMs.
- World ID/AgentBook: keep World ID for strongest unique-human proof, or later replace with a Solana-native identity/pass provider. Do not treat wallet uniqueness as human uniqueness.

## MVP Milestones

1. Solana foundation: Anchor workspace, wallet provider, RPC config, local/devnet tests.
2. Core market program: create market, buy shares, escrow USDC/SPL, claim payout.
3. Oracle voting program: register agent, commit vote, reveal vote, tally, resolve.
4. Agent bridge: adapt current API agent calls to submit commits/reveals to Solana.
5. Frontend migration: replace Wagmi/RainbowKit market flows with Solana wallet and program reads.

## Build Status

- `mvp_complete`: true
- `tests_passing`: true
- `devnet_deployed`: true
- `program_id`: `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx`
- `milestones_completed`:
  - `M1: Anchor dive_oracle program scaffolded and locally verified`
  - `M1.5: TypeScript Solana commit-hash adapter added`
  - `M2: SPL token escrow and payout added`
  - `M3: Agent bridge API route added (pages/api/commands/solana-bridge.ts)`
  - `Security: resolve-1/2 auth + committeeSize cap, resolve_market deadline check, settle_reputation authority signer, verifyWorldIDProof HTTP check, world-agentkit.ts TS errors fixed — zero TS errors project-wide`
  - `M4: Bridge completed (register_agent, create_market, place_bet, claim_payout actions added). ReadMarket upgraded to IDL-based deserialization via BorshCoder. Zero TS errors project-wide.`
  - `M5: Solana-first frontend refactor completed. Main product routes now use a shared Solana workspace (`/`, `/home`, `/market`, `/agents`, `/dispute`, `/solana`), legacy EVM-facing pages were retired from the primary flow, the global Wagmi/RainbowKit wrapper was removed, and solana-bridge validation/default program ID were fixed.`

## Completed Milestone Notes

### M1: Anchor Oracle Core

Files:
- `Anchor.toml`
- `programs/dive-oracle/Cargo.toml`
- `programs/dive-oracle/src/lib.rs`

Implemented instructions:
- `register_agent`
- `create_market`
- `commit_vote`
- `reveal_vote`
- `resolve_market`
- `settle_reputation`

Important design choices:
- Vote commits use `sha256([outcome_u8] || salt_32_bytes)`.
- `HumanVoteMarker` PDA prevents the same `human_id_hash` from voting multiple times in one market, even through multiple agent wallets.
- Reputation starts at `10`, adds `10` for correct revealed votes, subtracts `5` for incorrect revealed votes.

Verification:
- `cargo test --manifest-path programs/dive-oracle/Cargo.toml` passed.
- `NO_DNA=1 anchor build` passed and generated `target/idl/dive_oracle.json`.

### M1.5: Solana Commit Adapter

Files:
- `lib/solana/dive-oracle.ts`

Implemented helpers:
- `generateSolanaSalt`
- `computeSolanaCommitHash`
- `verifySolanaCommitHash`
- `marketIdToBytes32`
- `humanIdToHash`
- `evidenceToHash`

Verification:
- Targeted TypeScript check passed for `lib/solana/dive-oracle.ts`.
- Repo-wide TypeScript check currently fails in existing `lib/world-agentkit.ts` calls, unrelated to the Solana adapter.

### M2: SPL Token Escrow and Payout

Files:
- `programs/dive-oracle/Cargo.toml` — added `anchor-spl` + `init-if-needed` feature
- `programs/dive-oracle/src/lib.rs` — added escrow instructions and account
- `lib/solana/dive-oracle.ts` — added payout helpers

New on-chain accounts:
- `BetEscrow` PDA `[b"bet", market, bettor]` — records a single bettor's position
- Vault token account PDA `[b"vault", market_id]` — holds all SPL tokens for a market

New instructions:
- `place_bet(outcome, amount)` — transfers SPL tokens from bettor → vault, creates BetEscrow
- `claim_payout()` — after resolution, transfers proportional share from vault → winner

Market account extended with `yes_pool` and `no_pool` (u64) fields.

New TypeScript helpers:
- `vaultSeeds(marketIdHex)` — PDA seeds for the vault token account
- `betEscrowSeeds(marketPubkeyBytes, bettorPubkeyBytes)` — PDA seeds for BetEscrow
- `computePayout(betAmount, yesPool, noPool, resolvedOutcome)` — mirrors on-chain payout math

Verification:
- `cargo test` passes: 10 tests (4 original + 5 payout math + test_id)
- TypeScript check passes for `lib/solana/dive-oracle.ts`

### M4: Bridge Completion + Frontend Read Upgrade

Files:
- `pages/api/commands/solana-bridge.ts` — added register_agent, create_market, place_bet, claim_payout
- `pages/solana.tsx` — ReadMarket now uses BorshCoder for full IDL-based deserialization

New bridge actions:
- `register_agent` — derives agent + reputation PDAs, calls `registerAgent` instruction
- `create_market` — derives market PDA, calls `createMarket` instruction
- `place_bet` — derives vault + betEscrow PDAs, calls `placeBet` instruction; ATA derived manually (no @solana/spl-token dep)
- `claim_payout` — derives vault + betEscrow PDAs, calls `claimPayout` instruction

ReadMarket upgrade:
- Uses `BorshCoder` from `@coral-xyz/anchor` to decode the `Market` account
- Displays all fields: status, pools, vote counts, deadlines, resolved outcome (human-readable labels)

Verification:
- Zero TypeScript errors project-wide

### M5: Solana Oracle Agent Driver

File: `pages/api/commands/solana-resolve.ts`

Architecture decision: **do not rebuild the agent system** — the existing iNFT + 0G Compute + hedera-state.json stack is kept as-is. The new file is a thin adapter that:
- Reuses `getMintedAgents` / `selectCommittee` / `callAgent` from `lib/agent-helpers.ts`
- Calls 0G Compute TEE inference via `/api/inft/infer` (existing route)
- Computes Solana commit hashes via `lib/solana/dive-oracle.ts` helpers
- Submits `commit_vote` + `reveal_vote` + `resolve_market` + `settle_reputation` on-chain
- Falls back gracefully with `skipOnChain: true` for dry-run / testing

Agent identity on Solana: operator wallet signs all txs; each agent is identified by a unique `human_id_hash` derived from their iNFT tokenId. The `HumanVoteMarker` PDA prevents double-voting per human.

Usage:
```bash
curl -X POST http://localhost:3000/api/commands/solana-resolve \
  -H "Content-Type: application/json" \
  -H "x-api-key: $INTERNAL_API_KEY" \
  -d '{
    "marketIdHex": "0000000000000000000000000000000000000000000000000000000000000001",
    "question": "Will BTC exceed $100k by end of 2025?",
    "committeeSize": 3,
    "skipOnChain": true
  }'
```

Verification: Zero TypeScript errors project-wide.

### M6: Solana-First Frontend Shell

Files:
- `components/solana/SolanaWorkspace.tsx`
- `pages/index.tsx`
- `pages/home.tsx`
- `pages/market.tsx`
- `pages/dash.tsx`
- `pages/agents.tsx`
- `pages/dispute.tsx`
- `pages/solana.tsx`
- `pages/register.tsx`
- `pages/event.tsx`
- `pages/inft.tsx`
- `pages/claw.tsx`
- `pages/minikit.tsx`
- `components/Providers.tsx`
- `pages/api/commands/solana-bridge.ts`

Implemented:
- Replaced the old EVM-first product shell with a shared Solana workspace component.
- Routed the main user-facing pages into Solana views for overview, markets, agents, automation, and full studio access.
- Exposed Solana program reads, market creation, escrow actions, agent registration, manual commit/reveal controls, and automated resolution from one interface.
- Removed the global Wagmi/RainbowKit wrapper from `_app` by simplifying `components/Providers.tsx` to a neutral query provider.
- Fixed `solana-bridge` so `register_agent` and `create_market` no longer fail on a spurious `marketIdHex` requirement, and aligned its default program ID with the deployed devnet program.

Verification:
- `npm run build` passes with the Solana-first route set and neutral global provider.

## Review

- `security_score`: B+ (P0 `ResolveMarket` resolver Signer dead code removed — program now correctly enforces permissionless resolution after deadline with no unused signer field)
- `quality_score`: B
- `ready_for_mainnet`: false (devnet only — single operator wallet, no per-agent keypairs, no fuzz testing)

### Findings from this review

#### P0 — FIXED

1. **`ResolveMarket` resolver Signer dead code removed** (`lib.rs:465`)
   - Dead `resolver: Signer<'info>` field removed from `ResolveMarket` accounts struct
   - Resolution is intentionally permissionless after reveal deadline — deadline check in instruction body enforces timing
   - Build context documented this as the intended design; now code matches the comment
   - Fix verified: `cargo test` passes (13 tests), `anchor build` succeeds

#### P1 — Fix before mainnet

2. **`resolve_market` resolver field is dead code** (`lib.rs:463-465`)
   - The `resolver: Signer<'info>` account is fetched and checked as a signer, but never used in the instruction body
   - The instruction uses only market account state (status, deadlines, vote counts) to determine outcome
   - Fix: Remove the `resolver` field from the `ResolveMarket` struct entirely, or add a comment explaining it's reserved for future fee collection

3. **`place_bet` `init_if_needed` on vault has no additional validation** (`lib.rs:584-591`)
   - Vault is created `init_if_needed` with seeds `[b"vault", market.market_id.as_ref()]`, bump
   - If vault already exists (previous `place_bet` call), `init_if_needed` is a no-op — but this is fine since seeds+bump uniquely identify it
   - No issue here, but the `init_if_needed` pattern means the vault can be created by any bettor — verify this is intentional (it is — vault is market-wide, not bettor-specific)

4. **No type discriminator check on `Agent` account** (`lib.rs:415`)
   - `CommitVote` and `RevealVote` use `has_one = authority` on the agent account, but Anchor's `Account<'info, T>` automatically checks the 8-byte discriminator
   - Anchor handles this automatically. No fix needed.

5. **`solana-resolve.ts` — single-agent on-chain constraint is architectural limit** (documented, acceptable for MVP)
   - Every agent in the committee shares the same on-chain `Agent` PDA because all commits come from the operator wallet
   - True per-agent votes require per-agent Solana keypairs
   - Not a security bug but a scalability limitation

6. **`VoteRecord` not closed after `settle_reputation`** (rent leak — P2)
   - `VoteRecord` remains on-chain after settlement, consuming ~200+ bytes indefinitely
   - Fix: Add `close = authority` to the `vote_record` account in `SettleReputation` context, similar to how `BetEscrow` uses `close = bettor`

7. **`HumanVoteMarker` prevents double-voting per human, but not per agent wallet** (acceptable)
   - Multiple agents with different `human_id_hash` values created by the same operator wallet would each get their own marker
   - The `HumanVoteMarker` seed is `[b"human-vote", market, human_id_hash]` — so the same human in different agents can vote in different rounds
   - This is the intended design per build context notes

#### P2 — Fix before TVL > $10k

8. **Payout math in `claim_payout` uses u128 → u64 truncation** (`lib.rs:341-345`)
   - `payout as u64` after `checked_div` — if the calculation exceeds u64 max, it truncates silently
   - With very large pools (e.g., 1B tokens bet on each side), `bet_amount * total_pool / winning_pool` could overflow u128 before the division
   - Fix: Use u128 throughout and validate the result fits in u64 before casting, or add a `checked_mul` that returns an error if the result exceeds `u64::MAX`

9. **`place_bet` amount not validated against bettor's token balance** (`lib.rs:260-310`)
   - The program transfers `amount` from bettor's ATA without checking the ATA has sufficient balance
   - Anchor's `token::transfer` will fail at runtime if balance is insufficient — not a silent bug, but the error message to users is confusing
   - Fix: Read `bettor_token_account.amount` before transfer, require `amount <= balance`

10. **`commit_vote` can be called multiple times by same agent in same round** (`lib.rs:95-131`)
    - `HumanVoteMarker` uses `[b"human-vote", market, human_id_hash]` — it prevents the same human from voting multiple times across different agents
    - But the `VoteRecord` seed includes `agent.key()` — so if the same agent calls `commit_vote` twice in round 1, it re-initializes the same VoteRecord PDA (Anchor allows re-init if `init_if_needed` was used, but this uses `init` which would fail on second call)
    - Actually `init` on an existing PDA would error — so this is fine

### Prior findings (already fixed)

- P0: `declare_id!` updated to deployed devnet ID
- P0: `NEXT_PUBLIC_INTERNAL_API_KEY` exposure documented
- P1: Reputation `checked_sub` replaced with `saturating_sub().max(0)`
- P1: Single-agent-PDA constraint documented
- P2: `BetEscrow` now has `close = bettor` — rent reclaimed on claim_payout

### Known limitations (not blocking for hackathon)

- One operator wallet = one on-chain Agent PDA. Multi-agent simulation is off-chain only.
- `VoteRecord` not closed after settle (rent leak — fix in P2)
- `consensus_bps` minimum is 5001 (50.01%) — policy should enforce 7000 at creation
- No fuzz testing (Trident) before mainnet
- No on-chain market list — market discovery depends on off-chain indexer or JSON feed
- No perp-market or lending integration — SPL only
