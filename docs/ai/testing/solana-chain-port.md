---
phase: testing
title: Solana Chain Port — Testing Strategy
description: Test coverage goals, test cases, and quality assurance for the Solana migration
---

# Testing Strategy: Solana Chain Port

## Test Coverage Goals

**What level of testing do we aim for?**

- **Unit tests**: 100% of new Anchor program instructions (Rust) + TypeScript library functions
- **Integration tests**: All API route flows (agent registration, market CRUD, voting, settlement)
- **End-to-end tests**: Complete user journeys from wallet connect to payout receipt
- **Migration tests**: hedera-state.json → Solana PDA migration correctness
- **Alignment**: All tests must pass on Solana Devnet before Mainnet deployment

## Unit Tests

### Anchor Program Tests (per `solana-anchor-claude-skill` — using Anchor test framework + LiteSVM)

#### Registry Program (`programs/dive-protocol/tests/registry.spec.ts`)

- [ ] `register_agent` — creates Agent PDA with correct fields (authority, name, config_uri, reputation=0, timestamp)
- [ ] `register_agent` — fails if agent already registered (duplicate authority)
- [ ] `update_agent` — updates name and config_uri fields
- [ ] `update_agent` — fails if called by non-authority wallet
- [ ] `close_agent` — reclaims rent and zeroes the account
- [ ] PDA derivation — Agent PDA address is deterministic (`[b"agent", authority]`)

#### Market Program (`programs/dive-protocol/tests/market.spec.ts`)

- [ ] `create_market` — creates Market PDA + SPL mint with correct decimals (6)
- [ ] `create_market` — market status = Open, resolved_outcome = None
- [ ] `mint_shares` — increases buyer's Shares PDA balance for correct outcome index
- [ ] `mint_shares` — fails if market status != Open
- [ ] `mint_shares` — fails if outcome index out of bounds
- [ ] `transfer_shares` — moves shares between two Shares PDAs
- [ ] `set_resolution_authority` — updates authority, fails for non-creator
- [ ] `close_market` — closes Market + SPL mint (admin only)
- [ ] Market token decimals = 6 (matches USDC precision for easy settlement)

#### Oracle Program (`programs/dive-protocol/tests/oracle.spec.ts`)

- [ ] `submit_vote` — creates Vote PDA with correct fields (voter, market, outcome, stake)
- [ ] `submit_vote` — updates Reputation PDA score (+stake for correct vote, future logic)
- [ ] `submit_vote` — fails if market is Resolved/Disputed/Cancelled
- [ ] `submit_vote` — fails if stake = 0
- [ ] `resolve_market` — sets Market.resolved_outcome, sets status = Resolved
- [ ] `resolve_market` — fails if called by non-resolution_authority
- [ ] `open_dispute` — sets Market.status = Dispute
- [ ] `open_dispute` — fails if market already Resolved
- [ ] `settle_market` — distributes payouts correctly (winner gets all losing stakes)
- [ ] `settle_market` — fails if market not Resolved
- [ ] `update_reputation` — recomputes score from Vote PDA history
- [ ] PDA derivation — Vote PDA deterministic for `(market, voter)` seed
- [ ] Reputation PDA — deterministic for `(authority)` seed

### TypeScript Library Tests (`__tests__/` directory)

#### `lib/solana/anchor-client.ts`
- [ ] `getRegistryProgram()` — returns valid Program instance
- [ ] `getMarketProgram()` — returns valid Program instance
- [ ] `getOracleProgram()` — returns valid Program instance
- [ ] Program IDLs match deployed program addresses

#### `lib/solana/metaplex-nft.ts`
- [ ] `mintAgentNft()` — returns mint address, transaction succeeds
- [ ] `mintAgentNft()` — NFT is part of DIVE collection
- [ ] `updateAgentNftMetadata()` — metadata updated on-chain
- [ ] Fails gracefully if payer has insufficient SOL

#### `lib/solana/said-verifier.ts`
- [ ] `verifyHuman()` — returns `{ verified: true }` for valid SAID
- [ ] `verifyHuman()` — returns `{ verified: false }` for non-SAID wallet
- [ ] `registerSAID()` — transaction signature returned
- [ ] Fails on network error (timeout → retry-able error)

#### `lib/solana/dive-market.ts`
- [ ] `createMarket()` — returns `{ marketPda, tokenMint, tx }`
- [ ] `mintShares()` — buyer Shares PDA balance increases
- [ ] `getMarketState()` — returns decoded Market account data
- [ ] `getSharesPosition()` — returns decoded Shares account data
- [ ] Fails if market not found (throws Anchor program error)

#### `lib/solana/oracle.ts`
- [ ] `submitVote()` — Vote PDA written, tx signature returned
- [ ] `resolveMarket()` — Market PDA status = Resolved
- [ ] `getVoteTally()` — returns correct outcome → count mapping
- [ ] `settleMarket()` — winners receive USDC transfer
- [ ] `getReputation()` — returns score from Reputation PDA

#### `lib/solana/jupiter-settlement.ts`
- [ ] `getUSDCQuote()` — returns quote amount in USDC micro-units
- [ ] `settlePayout()` — USDC transfer tx confirmed
- [ ] `getMarketLiquidity()` — returns pool depth info

#### `lib/solana/switchboard-vrf.ts`
- [ ] `requestRandomness()` — VRF request tx submitted
- [ ] `useVRFForDispute()` — random value used for tiebreaker outcome

#### `lib/solana/reputation.ts`
- [ ] `getReputation()` — O(1) read from Reputation PDA
- [ ] `syncReputation()` — recomputes from Vote PDA history
- [ ] Reputation score correctly updated after vote settlement

## Integration Tests

**How do we test component interactions?**

- [ ] **Agent registration flow** — Solana wallet connect → SAID verification → Metaplex NFT mint → Agent PDA written → verified in `getAgentPDA()`
- [ ] **Market creation + share purchase** — Create market → mint shares → verify Shares PDA → verify SPL token balance via `getTokenAccountBalance()`
- [ ] **Vote + resolution + payout** — Submit vote → resolve market → settle market → verify winner USDC balance increased
- [ ] **x402 payment flow** — Send inference request → receive 402 → send payment → receive inference result
- [ ] **SAID Protocol flow** — Verify SAID human → register → query agent by pubkey → SAID identity returned
- [ ] **Migration script** — Load `hedera-state.json` → run migration → verify all PDAs written correctly → verify SPL token balances match HTS balances
- [ ] **Front-end API routes** — Each `pages/api/solana/` route returns expected response shape and correct HTTP status codes

### API Endpoint Tests (`pages/api/solana/`) — using Vitest or Jest

- [ ] `POST /api/solana/agent/prepare` → returns `{ keypair: string, publicKey: string }`
- [ ] `POST /api/solana/agent/register` → returns `{ agentPubkey, nftMint, signature }` for valid wallet + SAID
- [ ] `POST /api/solana/agent/register` → returns 401 for missing wallet signature
- [ ] `POST /api/solana/agent/register` → returns 400 for invalid SAID
- [ ] `POST /api/solana/agent/mint-nft` → returns `{ mint, signature }`
- [ ] `POST /api/solana/market/create` → returns `{ marketPda, tokenMint, signature }`
- [ ] `POST /api/solana/market/mint-shares` → returns `{ signature, sharesPda }`
- [ ] `POST /api/solana/market/resolve` → returns `{ signature }`
- [ ] `POST /api/solana/market/resolve` → returns 400 for non-resolution_authority
- [ ] `POST /api/solana/vote` → returns `{ signature, votePda }`
- [ ] `POST /api/solana/payout` → returns `{ signature, amount }`
- [ ] `GET /api/solana/agent/:pubkey` → returns decoded Agent PDA data
- [ ] `GET /api/solana/market/:id` → returns decoded Market PDA data
- [ ] `GET /api/solana/shares/:market/:owner` → returns decoded Shares PDA data
- [ ] `GET /api/solana/state` → returns all PDAs for given wallet

### Migration Integration Tests

- [ ] **State equivalence** — All fields in `hedera-state.json` agents map to `Agent` PDA fields correctly
- [ ] **HTS → SPL token balance** — Migration script mints SPL tokens equal to HTS balances
- [ ] **Reputation** — HCS-20 computed balances → Reputation PDA scores (no data loss)
- [ ] **Partial migration recovery** — If migration fails midway, idempotent retry succeeds
- [ ] **Dry run on Devnet** — Full migration completes without errors on Devnet

## End-to-End Tests

**What user flows need validation?**

- [ ] **Agent onboarding flow** — User opens app → connects Phantom wallet → verifies SAID → registers as oracle agent → sees agent card with NFT + reputation
- [ ] **Market creation flow** — Creator connects wallet → fills market form → creates market → sees market card → copies market ID
- [ ] **Bet placement flow** — Bettor connects wallet → views market → buys Yes shares → verifies SPL balance → sees position in portfolio
- [ ] **Oracle resolution flow** — Oracle agent views pending markets → resolves market → triggers settlement → winners receive USDC
- [ ] **Dispute resolution flow** — Challenger opens dispute → VRF fires → random outcome selected → market settled
- [ ] **x402 inference payment flow** — Agent requests inference → receives 402 → pays USDC via x402 → receives LLM response
- [ ] **Cross-agent voting flow** — Multiple agents vote on same market → votes accumulated → resolution called → reputation updated

### Critical Path Testing

- [ ] Wallet connect works with Phantom, Backpack, Ledger on Devnet
- [ ] Agent registration completes in 1 transaction (< 1s on Devnet)
- [ ] Market creation completes in 1 transaction (< 1s on Devnet)
- [ ] Vote submission is confirmed (< 400ms on Devnet)
- [ ] Market resolution updates state (< 1s on Devnet)
- [ ] Payout settlement completes (< 2s on Devnet)
- [ ] No transaction failures due to compute unit limits

### Regression of Adjacent Features

- [ ] **0G Compute inference** — Inference still works via `/api/solana/infer` (only wallet gate changes)
- [ ] **Agent config encryption** — `lib/encrypt.ts` works with Solana key derivation (unchanged AES-256-GCM)
- [ ] **Skills documentation** — `skills.md` curl commands updated and functional
- [ ] **Frontend routing** — All existing pages load with new wallet adapter

## Test Data

**What data do we use for testing?**

- **Solana Devnet SOL airdrops** — Auto-fund test wallets with 2 SOL via Helius faucet or `solana airdrop`
- **Test SPL tokens** — Mint test USDC on Devnet for settlement testing
- **Test SAID identities** — Use SAID Protocol Devnet/test environment for verification
- **Test Metaplex collection** — Create test collection NFT on Devnet for agent minting
- **Test markets** — Create dummy markets (BTC > $100k, etc.) for market mechanics tests
- **Migration fixtures** — Export `hedera-state.json` as test fixture; load in migration tests
- **Helius Devnet RPC** — All tests use Helius Devnet (not public RPC, for reliability)

## Test Reporting & Coverage

**How do we verify and communicate test results?**

- Coverage commands: `anchor test` (generates coverage report) + `npm run test` (Vitest)
- Coverage thresholds: 100% for new Anchor programs; 90% for TypeScript libraries
- Coverage reports: `./target/coverage/` (Anchor) + `./coverage/` (Vitest)
- Manual testing sign-off required before Mainnet deployment
- Smoke tests after Devnet deployment (use Helius webhooks for real-time verification)

## Manual Testing

**What requires human validation?**

- **Wallet connect UI** — Phantom, Backpack, Ledger all connect cleanly
- **SAID verification button** — Flow works in World App-equivalent (SAID app)
- **Market creation form** — Form validation, submission, confirmation screen
- **Share purchase UI** — Balance updates correctly after purchase
- **Oracle resolution UI** — Outcome selection, evidence upload, confirmation
- **Payout receipt UI** — USDC amount shown correctly after settlement
- **x402 payment dialog** — Payment prompt, USDC approval, result display

## Performance Testing

**How do we validate performance?**

- **Market resolution timing** — `< 1 slot (~400ms)` on Devnet; target `< 1 slot` on Mainnet
- **Vote tallying** — `< 2s` for markets with up to 100 voting agents (via DAS batch fetch)
- **API response times** — All `/api/solana/` routes respond in `< 500ms` (excluding Solana tx confirmation)
- **PDA batch reads** — Fetch 100 accounts in single Helius DAS call `< 200ms`
- **Anchor program compute units** — Profile with `anchor build --skip-lint` + transaction simulation
- **Stress test** — 500 concurrent votes on a single market → measure settlement time

## Bug Tracking

**How do we manage issues?**

- Use GitHub Issues with labels: `solana-migration`, `bug`, `critical`
- Bug severity levels:
  - **Critical** — funds at risk, tx reverts causing loss → block deployment
  - **High** — tx reverts, no fund loss → fix before Mainnet
  - **Medium** — degraded UX, workaround exists → fix within 1 week
  - **Low** — cosmetic, docs error → fix within 2 weeks
- Regression testing strategy: run full test suite on every PR; smoke tests on every deployment
