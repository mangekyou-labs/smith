# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Smith is a Solana-native prediction market powered by AI agent oracles on 0G Compute. It uses a pari-mutuel betting model where winners split the opposing pool.

## Stack

- **Solana Devnet** — Anchor program (`smith_oracle`) for market accounts, vault escrow, voting
- **0G Galileo** — TEE-attested LLM inference via `@0glabs/0g-serving-broker`; agents registered as ERC-7857 iNFTs on 0G
- **Next.js** (Pages Router) — Frontend with wallet adapter; API routes for operator commands
- **Rust** — `programs/confidential-market/` (separate Anchor program)

## Build Commands

```bash
# Next.js
npm run dev      # Start on localhost:3000
npm run build    # Production build

# Solana Anchor program
anchor build    # Build smith-oracle + confidential-market
anchor test     # Run Anchor tests (requires solana-test-validator running)
cargo test --manifest-path programs/smith-oracle/Cargo.toml  # Unit tests (no validator)
```

## Skills / Commands

Claude Code commands live in `.claude/commands/`. Key ones:
- `create-market.md` — create market flow
- `register-agent.md` — agent registration
- `resolve-discussion.md` — oracle resolve workflow
- `debug.md` — structured bug investigation

Agent skills in `.agents/skills/solana-dev/SKILL.md` — Solana dev patterns, Anchor/American Airstrip references.

Encrypt FHE skill in `.claude/skills/encrypt-fhe.md` — invoke with `/encrypt-fhe` when working on Encrypt protocol FHE integration (confidential Solana computations via dWallet Labs Encrypt).

## Programs

| Program | Devnet ID | IDL |
|---|---|---|
| `smith_oracle` | `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx` | `target/idl/smith_oracle.json` |
| `confidential_market` | `BB17yKcbp9qNyokaNPo29gjFK9aYBEH69wpQgiRPZhwz` | None (FHE-based, no IDL yet) |

smith-oracle discriminator: `[47, 166, 112, 147, 155, 197, 86, 7]` (from `lib/0g-compute.ts:113`)

**Instruction discriminators** (from `lib/solana/tx-builders.ts`):
| Instruction | Discriminator |
|---|---|
| `place_bet` | `[222, 62, 67, 220, 63, 166, 126, 33]` |
| `claim_payout` | `[127, 240, 132, 62, 227, 198, 146, 133]` |

## Key Files

| File | Purpose |
|---|---|
| `lib/0g-compute.ts` | `callAgent()` via ServingBroker, `getMintedAgents()` from SuperpsAgents iNFT contract, committee selection, commit/reveal helpers |
| `lib/solana/smith-oracle.ts` | `vaultSeeds`, `betEscrowSeeds`, `computePayout` (mirrors on-chain math), `SolanaOutcome` constants |
| `lib/solana/tx-builders.ts` | Raw instruction builders for `place_bet`, `claim_payout` |
| `lib/solana/market-index.ts` | `getProgramAccounts` scanner + 30s cache for Market/BetEscrow accounts |
| `lib/solana/price-utils.ts` | `formatTokenAmount`, `formatUSD`, CoinGecko fetch |
| `pages/api/commands/solana-bridge.ts` | Operator write API: `register_agent`, `create_market` |
| `pages/api/commands/solana-resolve.ts` | Oracle automation: committee inference → `commit_vote` → `reveal_vote` → `resolve_market` → `settle_reputation` |

## Architecture

### On-chain account PDAs

| Account | PDA seeds |
|---|---|
| Market | `["market", market_id_bytes]` |
| Vault (TokenAccount) | `["vault", market_id_bytes]` |
| BetEscrow | `["bet", market_pubkey, bettor_pubkey]` |
| Agent | `["agent", authority_pubkey]` |
| Reputation | `["reputation", agent_pubkey]` |
| VoteRecord | `["vote", market_pubkey, agent_pubkey, round]` |
| HumanVoteMarker | `["human-vote", market_pubkey, human_id_hash]` |

### Market lifecycle

1. `create_market` → Market PDA + vault (no tokens yet)
2. `place_bet` → transfers SPL tokens into vault, creates/updates BetEscrow
3. After `commit_deadline` → `commit_vote` window opens
4. After `commit_deadline` passes → `reveal_vote` window
5. After `reveal_deadline` → `resolve_market` tallies votes
6. Winners call `claim_payout` → vault transfers proportional share via PDA signer seeds

### Oracle committee

- Agents are ERC-7857 iNFTs minted on 0G Galileo (`SuperpsAgents` contract at `SUPERPS_AGENTS_ADDRESS`)
- `getMintedAgents()` fetches agents by tokenId (2-9), derives `humanIdHash = keccak256(tokenId)` for Solana `HumanVoteMarker` PDA
- `selectCommittee()` picks top-N by reputation score
- Each agent: TEE inference via 0G ServingBroker → `commit_hash = sha256([outcome_u8] || salt_32)` → on-chain `commit_vote` → `reveal_vote` → `settle_reputation`
- Reputation: correct vote `+10`, wrong vote `−5` (floor 0)

### Confidential market program

`programs/confidential-market/` is a separate Anchor workspace program. Not integrated into the Next.js frontend yet. Excluded from Next.js build via `tsconfig.json` exclude pattern.

### Encrypt pre-alpha

`encrypt-pre-alpha/` is a standalone Rust project (separate workspace, `rust-toolchain.toml`). Completely separate from the Next.js build. Excluded via `tsconfig.json` exclude pattern.

### Confidential market program

`programs/confidential-market/` is a separate Anchor workspace program using Encrypt Pre-Alpha FHE SDK. Bet amounts and pool sizes are encrypted — nobody (including the executor) can see individual bet values until decryption at settlement. Not yet integrated into the Next.js frontend. Excluded from Next.js build via `tsconfig.json` exclude pattern.

Build test: `cargo test --manifest-path programs/confidential-market/Cargo.toml`

## Known Issues (P1-P2)

- **`DEFAULT_MINT` placeholder** in `components/solana/PlaceBetModal.tsx` — uses a placeholder SPL token, not real devnet USDC. Needs real mint from env var.
- **Raw instruction builders** in `lib/solana/tx-builders.ts` — `buildPlaceBetIx`/`buildClaimPayoutIx` bypass Anchor's `init_if_needed` handling. Should switch to Anchor CPI.
- **VoteRecord rent drain** — `VoteRecord` accounts accumulate rent after `settled = true`. No close instruction exists yet.
- **Payout u128→u64 truncation** — `claim_payout` uses `as u64` cast without TryFrom validation. Large pools can overflow.
- **No balance pre-check in `place_bet`** — `token::transfer` fails with opaque error if bettor insufficient.

## Environment Variables

```
ZG_STORAGE_PRIVATE_KEY=...        # 0G wallet hex (no 0x) or Solana keypair JSON array
ZG_RPC_URL=https://rpc.0gai.com  # 0G Galileo testnet RPC
SOLANA_OPERATOR_SECRET_KEY=[...] # Solana operator key (JSON array)
INTERNAL_API_KEY=...             # API auth for bridge routes
NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID=CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
```
