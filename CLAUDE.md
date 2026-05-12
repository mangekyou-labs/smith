# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Smith is a Solana-native prediction market powered by AI agent oracles running in **AWS Nitro Enclaves**. Agents produce TEE attestation proofs (PCR0/PCR1 measurements) verified on-chain in the `smith_oracle` program. Pari-mutuel betting model where winners split the opposing pool.

## Stack

- **Solana Devnet** — Anchor program (`smith_oracle`) for market accounts, vault escrow, voting, TEE attestation verification
- **AWS Nitro Enclaves** — TEE environment running Gemini inference; returns `{response, attestation_document}` where the document is CBOR-encoded with PCR0/PCR1 + certificate chain
- **Next.js** (Pages Router) — Frontend with Solana wallet adapter; API routes for operator commands
- **Rust** — `programs/confidential-market/` (separate FHE Anchor program, not yet integrated)

## Build Commands

```bash
# Next.js
npm run dev      # Start on localhost:3000
npm run build    # Production build
npx tsc --noEmit # TypeScript check (errors in encrypt-pre-alpha/ and legacy EVM pages OK)

# Solana Anchor programs
anchor build    # Build all programs
cargo test --manifest-path programs/smith-oracle/Cargo.toml  # smith_oracle unit tests (13 tests)
cargo test --manifest-path programs/confidential-market/Cargo.toml  # confidential_market tests

# TypeScript check for specific files (no false positives from excluded dirs)
npx tsc --noEmit 2>&1 | grep -v "encrypt-pre-alpha" | grep -v "ConnectWallet\|MyPositions\|PredictionMarket\|claw\|inft\|minikit"
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
| `smith_oracle` (Anchor module: `dive_oracle`) | `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx` | `target/idl/smith_oracle.json` |
| `confidential_market` | `BB17yKcbp9qNyokaNPo29gjFK9aYBEH69wpQgiRPZhwz` | None (FHE-based) |

smith-oracle discriminator: `[47, 166, 112, 147, 155, 197, 86, 7]` (from `lib/0g-compute.ts:113`)

**Key instruction discriminators** (from `lib/solana/tx-builders.ts` and `lib.rs`):
| Instruction | Discriminator |
|---|---|
| `place_bet` | `[222, 62, 67, 220, 63, 166, 126, 33]` |
| `claim_payout` | `[127, 240, 132, 62, 227, 198, 146, 133]` |
| `verify_attestation` | New — CBOR-parses Nitro attestation doc in instruction data |

## Key Files

| File | Purpose |
|---|---|
| `lib/nitro.ts` | `callNitroAgent(prompt)` — calls Nitro enclave HTTP endpoint (`NITRO_ENCLAVE_ENDPOINT`), returns `{response, attestation_document, hash}`. Replaces prior 0G ServingBroker integration. |
| `lib/0g-compute.ts` | `getSolanaAgents()` — fetches on-chain Agent accounts via getProgramAccounts + BorshCoder. `selectCommittee()`, `updateReputation()`, commit-hash helpers. |
| `lib/solana/smith-oracle.ts` | `vaultSeeds`, `betEscrowSeeds`, `computePayout` (mirrors on-chain math), `SolanaOutcome` constants |
| `lib/solana/tx-builders.ts` | Raw instruction builders for `place_bet`, `claim_payout` |
| `lib/solana/market-index.ts` | `getProgramAccounts` scanner + 30s cache for Market/BetEscrow accounts |
| `lib/0g-inft-contract.ts` | ERC-7857 iNFT contract ABI for SuperpsAgents on 0G Galileo (reference only — not used in current TEE flow) |
| `pages/api/commands/solana-bridge.ts` | Operator write API: `register_agent`, `create_market`, `place_bet`, `claim_payout` |
| `pages/api/commands/solana-resolve.ts` | Oracle automation: calls Nitro enclave → `commit_vote` → `reveal_vote` → `resolve_market` → `settle_reputation`. Has `skipOnChain` mode for mock demos. |
| `programs/smith-oracle/src/lib.rs` | On-chain program. `verify_attestation` instruction: CBOR-parses Nitro attestation doc, verifies PCR0/PCR1 + nonce, stores `AttestationRecord`. |

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
| AttestationRecord | `["attestation", market_pubkey, agent_pubkey, round]` |

### Market lifecycle

1. `create_market` → Market PDA + vault (no tokens yet)
2. `place_bet` → transfers SPL tokens into vault, creates/updates BetEscrow
3. After `commit_deadline` → `commit_vote` window opens
4. After `commit_deadline` passes → `reveal_vote` window
5. After `reveal_deadline` → `resolve_market` tallies votes
6. Winners call `claim_payout` → vault transfers proportional share via PDA signer seeds

### Oracle TEE flow

1. `solana-resolve.ts` calls `callNitroAgent(prompt)` → enclave runs Gemini in Nitro Enclave → returns `{response, attestation_document, hash}`
2. `attestation_document` (base64 CBOR) submitted to on-chain `verify_attestation` instruction
3. `verify_attestation` decodes CBOR, checks PCR0/PCR1 against hardcoded expected values, verifies nonce = sha256(market_id || agent_authority || round), stores `AttestationRecord`
4. Then standard commit-reveal: `commit_hash = sha256([outcome_u8] || salt_32)` → `commit_vote` → `reveal_vote` → `resolve_market` → `settle_reputation`
5. Reputation: correct vote `+10`, wrong vote `−5` (floor 0)

**Enclave endpoint**: `NITRO_ENCLAVE_ENDPOINT` env var. Enclave app runs on AWS Nitro EC2, calls Gemini, returns Nitro attestation document CBOR with `{pcr0, pcr1, public_key, nonce, certificate_chain}`.

### Encrypt pre-alpha

`encrypt-pre-alpha/` is a standalone Rust project (separate workspace, `rust-toolchain.toml`). Completely separate from the Next.js build. Excluded via `tsconfig.json` exclude pattern.

Build test: `cargo test --manifest-path programs/confidential-market/Cargo.toml`

## Known Issues

- **`getMintedAgents()` returns `[]`** in `lib/0g-compute.ts` — 0G iNFT agent fetching is stubbed. Use `getSolanaAgents()` which reads on-chain `Agent` accounts. Committee falls back to hardcoded mock agents when no on-chain agents exist.
- **PCR0/PCR1 not yet configured** — `verify_attestation` uses hardcoded zeros for expected enclave measurements. After building the Nitro enclave binary, measure it (via `nitro-cli`) and update the `expected_pcr0/1` values passed to the instruction.
- **`DEFAULT_MINT` placeholder** in `components/solana/PlaceBetModal.tsx` — placeholder SPL token, not real devnet USDC. Set `NEXT_PUBLIC_DEVNET_USDC_MINT` env var.
- **`vote_record` rent drain** — `VoteRecord` is closed via `close = authority` in `SettleReputation`, but only after `settle_reputation` is called. Orphaned VoteRecords (if settle is never called) accumulate rent.
- **Certificate chain not verified** — `verify_attestation` skips the `certificate_chain` field from the Nitro attestation doc. The enclave identity chain (leaf → AWS Nitro root CA) is not verified on-chain.
- **Nitro enclave endpoint unauthenticated** — `NITRO_ENCLAVE_ENDPOINT` accepts requests from anyone with network access. Must be network-isolated (private VPC/subnet, no internet exposure). enclave unavailability causes `solana-resolve` to return 503 (fail-closed), not silent fallback.

## Security Notes

- `/api/commands/solana-resolve` requires `INTERNAL_API_KEY` — no bypass mode. Returns 500 if env var missing.
- `/api/commands/solana-bridge` requires `x-api-key: INTERNAL_API_KEY` header.
- `skipOnChain=true` in request body still runs inference but skips on-chain transactions — auth is still required.
- Operator key (`SOLANA_OPERATOR_SECRET_KEY`) is the sole signer for all on-chain agent actions. Compromise = full system compromise.
- `solana-resolve` response excludes `attestationDocument` (full CBOR base64) — only `attestationHash` is returned.

## Environment Variables

```
NITRO_ENCLAVE_ENDPOINT=https://...     # Nitro enclave HTTP endpoint (required for real TEE inference)
SOLANA_OPERATOR_SECRET_KEY=[...]       # Solana operator key (JSON array)
INTERNAL_API_KEY=...                  # API auth for bridge routes
NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID=CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_DEVNET_USDC_MINT=...       # Devnet USDC mint for betting (currently placeholder)
```
