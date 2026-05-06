---
phase: planning
title: Solana Chain Port — Project Planning
description: Task breakdown, milestones, dependencies, and risk analysis for migrating DIVE to Solana
---

# Project Planning: Solana Chain Port

## Milestones

- [ ] **M1: Foundation** — Solana dev environment setup, Anchor program scaffolding, Helius RPC connection
- [ ] **M2: Core Protocol** — DIVE Registry + Market + Vote programs deployed to Devnet
- [ ] **M3: Agent Identity** — Metaplex Core NFT minting + SAID Protocol integration
- [ ] **M4: Market Mechanics** — Market creation, SPL share minting, outcome resolution
- [ ] **M5: Payment Settlement** — Jupiter USDC settlement, x402 micropayments
- [ ] **M6: Frontend Migration** — Replace RainbowKit/Wagmi with @solana/wallet-adapter, all API routes updated
- [ ] **M7: State Migration** — hedera-state.json → Solana PDAs, SPL token positions, reputation
- [ ] **M8: Integration & Testing** — Full end-to-end flow on Devnet, security audit
- [ ] **M9: Production Deployment** — Program deployment to Solana Mainnet, frontend switch

## Task Breakdown

### Phase 1: Foundation (M1)

#### 1.1 Solana development environment
- [ ] Install Anchor framework (`cargo install anchor-cli`) or confirm via npx
- [ ] Create Anchor workspace: `programs/dive-protocol/`
- [ ] Create Anchor.toml with Devnet + Mainnet config
- [ ] Add `@solana/web3.js`, `@solana/wallet-adapter`, `@project-serum/anchor` to `package.json`
- [ ] Add skills dependencies: `metaplex-skill`, `helius-skill`, `solana-anchor-claude-skill`
- [ ] Generate Anchor IDL output directory: `./target/idl/`
- [ ] Configure Helius RPC (get Devnet API key from Helius)
- [ ] Add Helius RPC URL to `.env.local` as `NEXT_PUBLIC_HELIUS_RPC_URL`
- [ ] Add Solana payer keypair to `.env.local` as `SOLANA_PAYER_KEY`
- [ ] Create `lib/solana/anchor-client.ts` — Anchor IDL generated client
- [ ] Create `lib/solana/helius-rpc.ts` — Helius RPC helper (connection, tx sending)
- [ ] Test: `anchor build` succeeds, Devnet connection works

#### 1.2 Keypair management (replaces Hedera account creation)
- [ ] `lib/solana/keypair.ts` — Solana keypair generation / import utilities
- [ ] `pages/api/solana/prepare-agent.ts` — Replace `/api/inft/prepare-agent` (creates Solana keypair)
- [ ] Update `skills.md` with new Solana prepare-agent curl command

### Phase 2: Core Programs (M2)

#### 2.1 DIVE Registry Program
- [ ] `programs/dive-protocol/programs/registry/src/lib.rs` — Anchor program
  - [ ] `register_agent` instruction — initialize Agent PDA
  - [ ] `update_agent` instruction — update config_uri, name
  - [ ] `close_agent` instruction — reclaim rent
- [ ] `programs/dive-protocol/programs/registry/src/instructions/register.rs`
- [ ] `programs/dive-protocol/programs/registry/src/accounts/agent.rs`
- [ ] Write Anchor IDL for registry program
- [ ] Deploy to Devnet: `anchor deploy --provider.cluster devnet`

#### 2.2 DIVE Market Program
- [ ] `programs/dive-protocol/programs/market/src/lib.rs` — Market program
  - [ ] `create_market` instruction — initialize Market PDA + create SPL mint
  - [ ] `mint_shares` instruction — mint SPL tokens to buyer
  - [ ] `transfer_shares` instruction — peer-to-peer share transfer
  - [ ] `set_resolution_authority` instruction — update who can resolve
- [ ] Create SPL token mint on Devnet per market
- [ ] Write Anchor IDL for market program
- [ ] Deploy to Devnet

#### 2.3 DIVE Oracle/Vote Program
- [ ] `programs/dive-protocol/programs/oracle/src/lib.rs` — Oracle program
  - [ ] `submit_vote` instruction — write Vote PDA + update Reputation PDA
  - [ ] `resolve_market` instruction — set resolved_outcome on Market PDA
  - [ ] `open_dispute` instruction — trigger Switchboard VRF
  - [ ] `settle_market` instruction — distribute payouts based on resolved outcome
  - [ ] `update_reputation` instruction — recompute score from Vote PDA history
- [ ] Write Anchor IDL for oracle program
- [ ] Deploy to Devnet

### Phase 3: Agent Identity (M3)

#### 3.1 Metaplex Core NFT (replaces ERC-7857 iNFT)
- [ ] `lib/solana/metaplex-nft.ts` — Metaplex Core NFT minting utility
  - [ ] Create collection NFT for DIVE agents
  - [ ] Mint agent identity NFT with config_uri in metadata
  - [ ] Update NFT metadata when agent config changes
- [ ] `pages/api/solana/agent/mint-nft.ts` — API route for NFT minting
- [ ] Integrate with agent registration flow: mint NFT → get mint → store in Agent PDA

#### 3.2 SAID Protocol integration (replaces World ID)
- [ ] `lib/solana/said-verifier.ts` — SAID Protocol verification client
  - [ ] `verifyHuman(solanaPubkey)` — verify agent is a real human via SAID
  - [ ] `registerSAID(authority, saidId)` — link Solana wallet to SAID identity
  - [ ] `lookupHuman(solanaPubkey)` — SAID Protocol equivalent to AgentBook lookupHuman
- [ ] `pages/api/solana/agent/verify-said.ts` — API route for SAID verification
- [ ] Replace World ID verification in registration flow with SAID Protocol

### Phase 4: Market Mechanics (M4)

#### 4.1 Market creation + shares
- [ ] `lib/solana/dive-market.ts` — Market creation + share minting helpers
  - [ ] `createMarket()` — CPI call to Market program + SPL mint creation
  - [ ] `buyShares()` — mint SPL tokens to buyer wallet
  - [ ] `getMarketState()` — read Market PDA via Helius RPC
  - [ ] `getSharesPosition()` — read Shares PDA
- [ ] `pages/api/solana/market/create.ts` — Market creation API
- [ ] `pages/api/solana/market/mint-shares.ts` — Share minting API
- [ ] `pages/api/solana/market/get-state.ts` — Market state read API

#### 4.2 Outcome resolution + voting
- [ ] `lib/solana/oracle.ts` — Oracle resolution + voting helpers
  - [ ] `submitVote()` — CPI call to Vote instruction
  - [ ] `resolveMarket()` — CPI call to resolve instruction
  - [ ] `getVoteTally()` — read all Vote PDAs for a market (via Helius DAS batch fetch)
  - [ ] `settleMarket()` — CPI call to settle + Jupiter payout
- [ ] `pages/api/solana/vote.ts` — Vote submission API
- [ ] `pages/api/solana/market/resolve.ts` — Resolution API
- [ ] `pages/api/solana/market/settle.ts` — Settlement API

#### 4.3 Reputation system (replaces HCS-20 balance replay)
- [ ] `lib/solana/reputation.ts` — Reputation score computation
  - [ ] On every vote: Reputation.score += stake if correct, -= stake if incorrect
  - [ ] `getReputation(wallet)` — O(1) read from Reputation PDA
  - [ ] `syncReputation(wallet)` — recompute from Vote PDA history (fallback)
- [ ] `pages/api/solana/reputation/sync.ts` — Reputation sync API

### Phase 5: Payment Settlement (M5)

#### 5.1 Jupiter USDC settlement (replaces x402/Base)
- [ ] `lib/solana/jupiter-settlement.ts` — Jupiter API helpers
  - [ ] `getUSDCQuote(inputToken, amount)` — Jupiter quote API
  - [ ] `settlePayout(winner, amount)` — USDC transfer via Jupiter swap or direct SPL transfer
  - [ ] `getMarketLiquidity()` — check Jupiter pool depth for market token
- [ ] `pages/api/solana/payout.ts` — Payout settlement API
- [ ] Integrate: `settle_market` program instruction calls Jupiter settlement via CPI

#### 5.2 x402 on Solana (agent micropayments)
- [ ] Set up `x402-proxy` for Solana USDC micropayments
- [ ] Update `middleware.ts` to intercept `/api/solana/infer` behind x402 Solana payment
- [ ] `pages/api/solana/infer.ts` — Inference gate with x402/Solana USDC auth
- [ ] Update `skills.md` with x402/Solana payment commands

#### 5.3 Switchboard VRF (dispute resolution)
- [ ] `lib/solana/switchboard-vrf.ts` — Switchboard VRF integration
  - [ ] `requestRandomness(marketId)` — request VRF from Switchboard
  - [ ] `fulfillRandomness()` — callback from Switchboard with random value
  - [ ] `useVRFForDispute()` — random outcome selection as dispute tiebreaker
- [ ] Integrate into `open_dispute` instruction in oracle program

### Phase 6: Frontend Migration (M6)

#### 6.1 Wallet library swap (RainbowKit → @solana/wallet-adapter)
- [ ] `components/Providers.tsx` — Replace RainbowKit with `@solana/wallet-adapter`
  - [ ] Keep dynamic import + `ssr: false` pattern (same as current)
  - [ ] Add Phantom, Backpack, Ledger wallet adapters
- [ ] `components/WalletButton.tsx` — Solana wallet connect button
- [ ] `components/WalletProvider.tsx` — Wallet context provider
- [ ] Remove `lib/wagmi.ts` (EVM-only)
- [ ] Update `pages/_app.tsx` if needed

#### 6.2 API route migration
- [ ] `pages/api/inft/prepare-agent.ts` → `pages/api/solana/agent/prepare.ts`
- [ ] `pages/api/inft/register-agent.ts` → `pages/api/solana/agent/register.ts`
- [ ] `pages/api/inft/infer.ts` → `pages/api/solana/infer.ts`
- [ ] `pages/api/market/create.ts` → `pages/api/solana/market/create.ts`
- [ ] `pages/api/market/mint-shares.ts` → `pages/api/solana/market/mint-shares.ts`
- [ ] `pages/api/market/resolve.ts` → `pages/api/solana/market/resolve.ts`
- [ ] `pages/api/vote.ts` → `pages/api/solana/vote.ts`
- [ ] `pages/api/payout.ts` → `pages/api/solana/payout.ts`

#### 6.3 Page component updates
- [ ] `pages/index.tsx` — Replace Hedera state reads with Helius RPC reads
- [ ] `pages/agents.tsx` — Replace AgentBook with SAID Protocol lookup
- [ ] `pages/resolve.tsx` — Update to use Solana program CPI calls
- [ ] `pages/market/[id].tsx` — Use Market PDA reads instead of HCS topic

### Phase 7: State Migration (M7)

#### 7.1 hedera-state.json → Solana PDAs
- [ ] `scripts/migrate-hedera-state.ts` — Migration script
  - [ ] Read `hedera-state.json`
  - [ ] For each agent: call `register_agent` on Solana with same data
  - [ ] For each market: call `create_market` with same market config
  - [ ] For each share position: mint SPL tokens to match HTS balances
  - [ ] For each reputation score: write to Reputation PDA
- [ ] Run migration on Devnet first (dry run)
- [ ] Run migration on Mainnet before frontend cutover
- [ ] Archive `hedera-state.json` (read-only after migration)

#### 7.2 HCS topic archival
- [ ] Export all HCS topic messages to JSON file before migration
- [ ] Add "migrated" flag to hedera-state.json after successful migration
- [ ] Keep HCS topic export for historical reference

### Phase 8: Integration & Testing (M8)

#### 8.1 Unit tests (Anchor test framework)
- [ ] Registry program tests: register, update, close agent
- [ ] Market program tests: create, mint shares, transfer shares
- [ ] Oracle program tests: vote, resolve, settle, dispute
- [ ] Reputation tests: score computation correctness
- [ ] Use LiteSVM for local testing (per `solana-anchor-claude-skill`)

#### 8.2 Integration tests (Next.js API routes)
- [ ] Agent registration flow end-to-end (Solana wallet → PDA → NFT)
- [ ] Market creation + share purchase flow
- [ ] Vote + resolution + payout flow
- [ ] x402 payment flow for inference API
- [ ] SAID verification flow

#### 8.3 Frontend smoke tests
- [ ] Wallet connect (Phantom/Backpack)
- [ ] Agent registration page
- [ ] Market listing page
- [ ] Market detail + share purchase
- [ ] Outcome resolution page
- [ ] Payout receipt

### Phase 9: Production Deployment (M9)

- [ ] Final security audit (Trident Arena or Exo AI Audits)
- [ ] Deploy all 3 Anchor programs to Solana Mainnet
- [ ] Update `.env.local` with Mainnet Helius RPC, program IDs
- [ ] Mint production Metaplex collection NFT
- [ ] Run Mainnet state migration script
- [ ] Deploy Next.js to production with Solana Mainnet config
- [ ] Update `skills.md` with Mainnet curl commands
- [ ] Decommission Hedera Testnet accounts (optional — keep for archival)

## Dependencies

```
Phase 1 (Foundation)
  └─ No blockers — start here

Phase 2 (Core Programs)
  └─ Requires Phase 1 complete (Anchor workspace needed)

Phase 3 (Agent Identity)
  └─ Requires Phase 1 complete (Devnet connection)
  └─ Requires Phase 2 partially complete (Registry program)

Phase 4 (Market Mechanics)
  └─ Requires Phase 2 complete (Market + Oracle programs)

Phase 5 (Payment Settlement)
  └─ Requires Phase 4 complete (Market resolution must exist)

Phase 6 (Frontend Migration)
  └─ Can start parallel to Phase 2-5 (UI doesn't need programs deployed)
  └─ Requires Phase 3 for SAID Protocol button

Phase 7 (State Migration)
  └─ Requires Phase 2 + 3 + 4 complete (all PDAs have Solana equivalents)

Phase 8 (Testing)
  └─ Requires Phase 6 complete (frontend uses new routes)

Phase 9 (Production)
  └─ Requires Phase 8 complete (all tests passing)
  └─ External: Mainnet program deployment (requires SOL for rent)
```

## Timeline & Estimates

| Phase | Estimated Effort | Notes |
|---|---|---|
| Phase 1: Foundation | 3–4 days | Environment, Anchor setup, Helius connection |
| Phase 2: Core Programs | 5–7 days | 3 Anchor programs, 3 IDL outputs |
| Phase 3: Agent Identity | 2–3 days | Metaplex NFT, SAID Protocol |
| Phase 4: Market Mechanics | 3–4 days | Market CRUD, voting, resolution |
| Phase 5: Payment Settlement | 2–3 days | Jupiter, x402, Switchboard VRF |
| Phase 6: Frontend Migration | 4–5 days | Wallet library swap, all API routes |
| Phase 7: State Migration | 2–3 days | Migration script, archival |
| Phase 8: Testing | 3–4 days | Unit, integration, smoke tests |
| Phase 9: Production | 2–3 days | Audit, deployment, mainnet migration |
| **Total** | **~26–36 days** | Depends on team size; parallelizable phases reduce wall time |

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SAID Protocol not production-ready | Medium | High | Fallback to Solana signature verification; build abstraction layer |
| 0G Compute incompatible with Solana gate | Low | Medium | Keep inference API unchanged; only gate with Solana wallet signature |
| Anchor IDL generation failures | Low | Medium | Use `anchor build` + `anchor idl parse` for validation |
| Helius Devnet RPC rate limits | Medium | Low | Add fallback RPC; use DAS batch API for efficiency |
| Jupiter liquidity insufficient for settlement | Low | High | Use direct SPL USDC transfer; Jupiter only for swaps |
| Metaplex Core NFT minting cost (rent) | Low | Low | UseCompressed NFT (minimal rent); Light Protocol ZK compression if needed |
| Solana Mainnet slot finality variance | Low | Medium | Use confirmed tx finality; add polling for slot confirmation |
| x402 on Solana immaturity | Medium | Medium | Use `x402-proxy` MCP; manual USDC settlement fallback |
| State migration data loss | Medium | Critical | Dry run on Devnet first; keep hedera-state.json archived |
| Switchboard VRF availability | Low | Low | On-chain voting as primary dispute resolution; VRF as tiebreaker |

## Resources Needed

### Team Members & Roles
- 1 Solana developer (Anchor/Pinocchio programs)
- 1 TypeScript/Next.js developer (frontend + API routes)
- 1 DevOps (Helius setup, Mainnet deployment, monitoring)

### Tools & Services
- Helius account (Devnet + Mainnet RPC)
- Solana Devnet + Mainnet wallets (SOL for rent)
- SAID Protocol API key (for human verification)
- Metaplex Studio account (for collection NFT setup)
- Jupiter API key (for swap/settlement)
- Switchboard VRF queue (Devnet + Mainnet)
- x402-proxy deployment (for micropayments)
- Quicknode MCP (optional, for infrastructure management)

### Infrastructure
- Next.js hosting (Vercel, unchanged)
- Helius Webhook endpoints for real-time updates
- Solana RPC: Helius Solana (Devnet + Mainnet)
- 0G Compute inference endpoint (unchanged)

### Knowledge
- `solana-anchor-claude-skill` — Anchor program development
- `helius-skill` — Helius RPC, DAS API, webhooks
- `metaplex-skill` — Metaplex Core NFT minting
- `jupiter-skill` — Jupiter swap and settlement API
- `switchboard-skill` — VRF for dispute resolution
- `phantom-connect` — Phantom wallet integration
- `agentic-gateway` — x402 on Solana
- `light-protocol-skill` — ZK compression for rent (optional)
- `vulnhunter-skill` — Security scanning before mainnet deployment
