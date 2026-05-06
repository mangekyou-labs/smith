---
phase: requirements
title: Solana Chain Port
description: Migrate DIVE from Hedera/0G/World Chain/Base to Solana — replacing HCS topics with program accounts, ERC-7857 iNFTs with compressed NFTs (Metaplex Core), World ID with SAID Protocol or Solana-based identity, and x402/Base USDC with Solana-native payments via Jupiter.
---

# Requirements: Solana Chain Port

## Problem Statement

DIVE (Decentralized Intelligence Verification Engine) currently runs on a fragmented multi-chain stack:

- **Hedera Testnet** — HCS topics for voting, registry, reputation
- **0G Galileo Testnet** — iNFT registry (ERC-7857), agent storage, inference
- **World Chain mainnet** — AgentBook wallet→humanId lookup
- **Base Sepolia** — x402.org payment settlement (USDC)

This multi-chain architecture introduces significant complexity:

1. **Cross-chain state sync risk** — agents must coordinate across 4 different networks
2. **Dual wallet management** — Hedera account + EVM key per agent
3. **HCS message replay overhead** — no native indexing; every client replays topic messages on demand
4. **Limited Solana ecosystem reach** — DeFi liquidity, tooling, and user base live on Solana
5. **Ecosystem fragmentation** — developers familiar with Solana cannot easily contribute to a Hedera-based system

The goal is to **collapse this stack onto Solana**, leveraging the Solana Foundation's AI tooling ecosystem (awesome-solana-ai) while preserving DIVE's core mission: verified AI agents resolving prediction market outcomes with cryptographic certainty.

## Goals & Objectives

### Primary Goals

1. **Single-chain settlement** — All market resolution, voting, and registry writes happen on Solana
2. **Compressed NFT agent identity** — Replace ERC-7857 iNFT on 0G with Metaplex Core NFT on Solana
3. **Solana-native identity verification** — Replace World ID / AgentBook with SAID Protocol or Solana-verified human proof (e.g., signature-based verification)
4. **Jupiter-powered payments** — Replace x402/Base USDC with Jupiter swap + USDC settlement on Solana
5. **HCS → Solana program accounts** — Replace Hedera HCS message replay with on-chain PDA state
6. **Preserve prediction market logic** — Shares, payouts, market creation all remain intact
7. **Preserve AI agent inference** — Keep 0G Compute for LLM inference (or switch to Solana-native inference if viable)

### Secondary Goals

8. Use **Helius** for RPC, DAS API, and webhooks
9. Use **Switchboard** or **Pyth** for price feed oracles
10. Use **Jupiter DCA/limit orders** for market liquidity hooks
11. Use **Light Protocol ZK Compression** for rent-free state if needed
12. Support **x402 on Solana** for agent-to-agent micropayments
13. Align with **Solana Agent Kit** (20+ protocol actions) for extensibility

### Non-Goals

- Dropping AI inference capability (keep as-is or swap inference provider)
- Redesigning the prediction market mechanics (shares, odds, payouts)
- Adding new user-facing features beyond what's needed for chain migration
- Supporting Hedera or EVM chains post-migration (Solana-only going forward; Hedera API routes go read-only during 90-day sunset window then are removed)
- Implementing a full DeFi trading stack (no drift/kamino/etc. integration beyond payment settlement)
- Dual-chain active support post-migration — the 90-day sunset window is a transition aid, not a permanent state

## User Stories & Use Cases

- **As a** prediction market participant, **I want to** place bets on outcomes resolved by verified AI agents, **so that** I can earn returns when agents are correct
  - *Edge cases:* Two bettors hold equal opposing positions → settlement distributes proportionally. All bettors bet the same outcome → oracle takes the full opposing pool as fee. Bettor is also the market creator → stake is tracked separately to prevent conflict-of-interest manipulation.

- **As a** AI oracle agent, **I want to** register on-chain with a verified identity, **so that** market participants trust my predictions
  - *Edge cases:* SAID verification fails → fallback to Solana signature verification with "unverified" badge. Agent deregisters mid-market → existing markets remain active; resolution authority transfers to next-highest-reputation agent via governance vote.

- **As a** AI oracle agent, **I want to** submit outcome resolutions and have them voted on by other agents, **so that** incorrect resolutions can be challenged
  - *Edge cases:* Oracle submits false resolution → any agent can open a dispute within 48h by staking ≥10 USDC-equivalent; VRF tiebreaker fires if vote margin <10%. Two agents resolve simultaneously → first tx by slot wins; conflicting tx reverts.

- **As a** market creator, **I want to** create markets with custom question/outcomes, **so that** any real-world event can be bet on
  - *Edge cases:* Creator sets resolution authority to themselves → flagged in UI as conflict of interest. Market expires (end_time passes) with no resolution → any agent can trigger forced resolution via majority vote after 48h grace period.

- **As an** external AI agent (OpenClaw, Claude Code nanobot), **I want to** interact with DIVE via standard Solana actions, **so that** I can participate without learning a custom protocol
  - *Edge cases:* Agent uses Solana Agent Kit to interact → all 50+ actions available (token ops, swaps, NFT). Agent hits x402 paywall → micropayment auto-negotiated via x402-proxy; inference result returned.

- **As a** developer, **I want to** read DIVE program state using standard Solana RPC (Helius), **so that** I can build dashboards and analytics
  - *Edge cases:* Helius RPC rate-limited → falls back to public Devnet RPC. Market has 500+ voters → batch-fetch Vote PDAs via DAS API to avoid N+1 queries.

## Success Criteria

| Criterion | Measurement |
|---|---|
| Agent registration runs entirely on Solana | 1 API call (no Hedera/0G/World ID) |
| Market creation on Solana program | Program instruction executes successfully |
| Share minting via Solana SPL tokens | SPL token mint + transfer works |
| Outcome resolution via voting | Vote tally computed from on-chain data |
| Payment settlement via Jupiter/USDC | USDC transfer on Solana after market resolution |
| Identity verified via Solana-native mechanism | SAID Protocol or signature verification succeeds |
| Inference call still functional | 0G Compute or equivalent responds |
| x402 micropayments on Solana | USDC payment flows via x402/Solana |
| All existing users can migrate | Export → import of agent identity and market positions |

## Constraints & Assumptions

### Technical Constraints

- Must use **Anchor** or **Pinocchio** framework for Solana programs (per awesome-solana-ai skills)
- Must support **Solana Devnet** for testing; mainnet for production
- Next.js frontend uses **@solana/wallet-adapter** (replacing RainbowKit/Wagmi for wallet connections)
- All HCS-20 message replay logic replaced by **PDA-based state** in Solana programs
- ERC-7857 iNFT replaced by **Metaplex Core NFT** (per metaplex-skill)
- HTS token shares replaced by **SPL tokens** (per Solana token extension standards)
- All numeric values in TypeScript are `number` type (not string — this is a Hedera convention that does not apply on Solana)

### Business Constraints

- Must not require users to re-register existing agents from scratch (migration path required)
- Must preserve existing market positions and balances during migration
- Must support the same user flows as the current Hedera-based system
- **Migration cutover strategy: gradual sunset** — New markets deploy on Solana; existing Hedera markets settle out over a 90-day window; routing logic in frontend directs new activity to Solana; old API routes remain live in read-only mode during the window

### Time/Budget Constraints

- Target delivery: **8–10 weeks** for core migration (Phases 1–5); frontend migration (Phase 6) runs parallel
- No budget for external audits until Phase 9 production deployment
- Helius Devnet RPC is free; production Helius Mainnet RPC costs ~$40/mo (within existing infra budget)
- SOL cost for on-chain state: estimate ~0.1 SOL per agent + ~0.01 SOL per market (rent exemption)

### Assumptions

- **0G Compute inference** remains viable (Solana has no native LLM inference; 0G or a similar service is needed)
- **SAID Protocol** is production-ready and provides equivalent identity guarantees to World ID
- **Jupiter** USDC liquidity is sufficient for DIVE market settlement amounts
- **x402 on Solana** (via Quicknode or x402-proxy) supports agent micropayments
- **Helius Devnet RPC** is available for development

### Resolved Questions

The following were resolved during requirements review (Decided: **Gradual Sunset** migration + **Conditional VRF** dispute resolution):

1. ~~Should we use **SAID Protocol** or **Solana-native signature verification**?~~ → **SAID Protocol** — production-ready ecosystem-aligned choice with on-chain reputation and agent directory. Solana signature verification is fallback.
2. ~~Which inference provider on Solana?~~ → **Keep 0G Compute unchanged** — blockchain-agnostic; only the Solana wallet gate changes.
3. ~~Hedera for any specific piece?~~ → **Solana-only** for new features; Hedera kept read-only during 90-day sunset window.
4. ~~Anchor vs Pinocchio?~~ → **Anchor primary, Pinocchio for compute-heavy paths** (resolve/settle instructions).
5. ~~Metaplex Core NFT vs Token-2022?~~ → **Metaplex Core NFT** — matches ERC-7857 mental model, richer metadata.
6. ~~Market oracle disputes?~~ → **On-chain voting primary; Switchboard VRF conditional** — VRF fires only when ≥3 agents dispute and vote is within N% of each other (tiebreaker mode). Minimum dispute stake: 10 USDC-equivalent to prevent griefing.
7. ~~x402 token (USDC vs SPL)?~~ → **USDC on Solana** — x402-proxy + `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
8. ~~Front-end keep vs rebuild?~~ → **Keep Next.js, swap wallet library** — only `@solana/wallet-adapter` replaces RainbowKit/Wagmi.
9. ~~x402 on Solana architecture?~~ → **x402-proxy MCP + Quicknode RPC** via `agentic-gateway` skill.
10. ~~Light Protocol ZK compression?~~ → **Optional, deploy if rent costs become problematic** — not in initial scope.

### Open Questions

- [ ] **VRF tiebreaker threshold**: what % vote margin triggers VRF? (suggest 10% — if top two outcomes are within 10% of each other, VRF fires)
- [ ] **Minimum dispute stake**: 10 USDC-equivalent proposed — confirm or adjust
- [ ] **Pyth vs Switchboard for price feeds**: only needed if binary markets use on-chain price as an outcome (e.g., "BTC > $100k"); if oracle resolves by evidence, Pyth not needed. Confirm: does DIVE have self-resolving price markets?
- [ ] **Market resolution window**: after end_time, how long before resolution_authority must act? (suggest: 48h, then any agent can trigger forced resolution via majority vote)
