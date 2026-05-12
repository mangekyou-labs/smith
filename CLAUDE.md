# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Smith is a Solana-native prediction market powered by AI agent oracles running in **AWS Nitro Enclaves** (TEE). Agents produce TEE attestation proofs (PCR0/PCR1 measurements) verified on-chain in the `smith_oracle` program. Pari-mutuel betting — winners split the opposing pool.

## Stack

- **Solana Devnet** — Anchor program (`smith_oracle`, module `dive_oracle`) for market accounts, vault escrow, voting, TEE attestation verification
- **AWS Nitro Enclaves** — TEE environment for production inference; returns `{response, attestation_document}` where the document is CBOR-encoded with PCR0/PCR1 + certificate chain. Currently a standalone endpoint (`lib/nitro.ts`); production integration via `solana-resolve` is pending.
- **0G ServingBroker** (`@0glabs/0g-serving-broker`) — active inference layer used by `solana-resolve`. Wrapped by `lib/0g-compute.ts` with `callAgent()`.
- **Next.js** (Pages Router) — Frontend with `@solana/wallet-adapter-react`; API routes for operator commands
- **Rust** — `programs/smith-oracle/` (Anchor), `programs/confidential-market/` (FHE, integrated via `confidentialMode` toggle in PlaceBetModal)

## Build Commands

```bash
# Next.js
npm run dev          # Start dev server on localhost:3000
npm run build        # Production build

# TypeScript check (errors in encrypt-pre-alpha/ and programs/ OK to ignore — excluded in tsconfig.json)
npx tsc --noEmit 2>&1 | grep -v "encrypt-pre-alpha" | grep -v "programs/"

# Solana Anchor programs
anchor build
cargo test --manifest-path programs/smith-oracle/Cargo.toml   # 13 tests
cargo test --manifest-path programs/confidential-market/Cargo.toml
```

## Architecture

### Frontend Provider Chain

```
App
 └── Providers (dynamic import, ssr: false)
      └── QueryClientProvider
           └── SolanaProvider
                ├── ConnectionProvider
                ├── SolanaWalletProvider (autoConnect)
                │    └── WalletModalProvider
                │         └── children
                └── React Query mutations/queries
```

`SolanaProvider` is client-only (never runs on server) because `@solana/wallet-adapter-wallets` transitively imports `@ledgerhq/errors` which fails in Node.js. Always wrap wallet-hooks components inside this provider chain.

### Key frontend patterns

- **`PlaceBetModal`** — renders nothing when `open=false` (wrapper pattern). This prevents `useWallet()` from being called when modal is closed, which would throw without a provider. Hooks only run when `open=true`. Supports `confidentialMode` prop for encrypted betting.
- **`usePlaceBet(onSubmitted?)`** — accepts optional `onSubmitted` callback that fires when the transaction is submitted (before confirmation). Returns `BetTxResult` with `{ signature, state, error }`.
- **`useMarkets()`** — React Query wrapper around `getProgramAccounts` scanner. Caches for 30s.
- **`DisputeResolution`** (`components/DisputeResolution.tsx`) — dispute UI component. Calls `POST /api/commands/minikit-dispute` to run a 5-agent committee in `skipOnChain=true` mode. Used by `pages/dispute.tsx`. Returns `{ round1: { tally, reveals }, resolved, consensus }`.

### Confidential (FHE) Betting UX

Encrypted betting is integrated into the existing `PlaceBetModal` flow via a toggle:

1. User on `/market` → clicks YES/NO on a market card → `PlaceBetModal` opens
2. Modal has `[ Regular ] [ Confidential ✦ ]` toggle pills in the header
3. When Confidential is active:
   - Button label changes to "Encrypt Bet" (indigo)
   - `POST /api/commands/confidential-market` with `action=place_bet` — server-side operator key signs and submits to `confidential_market` program
   - Mock encryption preview shown inline: hex display of `EBool` (vote) and `EUint64` (amount) ciphertexts
   - Pre-alpha disclaimer: "Encryption is mocked — all data stored publicly on-chain"
4. Same `txState` feedback loop: pending → confirmed (or error)

Mock FHE ciphertext format: `[1 byte fhe_type || 16 bytes little-endian value]` (17 bytes total). Types: `FHE_BOOL=0`, `FHE_UINT64=4`.

### Solana lib files

| File | Purpose |
|---|---|
| `lib/solana/market-index.ts` | `getMarketAccounts()` — PDA scanner via `getProgramAccounts` + BorshCoder IDL deserialization |
| `lib/solana/tx-builders.ts` | Raw instruction builders for `place_bet`, `claim_payout` |
| `lib/solana/smith-oracle.ts` | PDA seeds (`vaultSeeds`, `betEscrowSeeds`), payout math, `SolanaOutcome` constants |
| `lib/solana/useMarkets.ts` | React Query hook for market list |
| `lib/solana/useTransactions.ts` | `usePlaceBet()` (returns `BetTxResult`), `useClaimPayout()` |
| `lib/solana/encrypt-grpc.ts` | FHE mock helpers: `encryptValue`, `bytesToHex`, `FHE_BOOL=0`, `FHE_UINT64=4`, `CONFIDENTIAL_MARKET_PROGRAM_ID` |
| `lib/nitro.ts` | `callNitroAgent(prompt)` — calls Nitro enclave HTTP endpoint, returns `{response, attestation_document, hash}`. Also exports `extractVote(text)`, `hashResponse(text)`. Standalone endpoint — not yet wired into `solana-resolve` flow. |
| `lib/0g-compute.ts` | 0G ServingBroker wrapper: `callAgent()`, `selectCommittee()`, `extractVote()`, `generateSolanaSalt()`, `updateReputation()`, `getSolanaAgents()`, `getMintedAgents()`. Uses `ZGComputeNetworkBroker` from `@0glabs/0g-serving-broker`. Falls back to mock agents when on-chain agent list is empty |

### API routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/commands/solana-bridge` | `x-api-key: INTERNAL_API_KEY` | Operator write API: `register_agent`, `create_market`, `place_bet`, `claim_payout` |
| `POST /api/commands/confidential-market` | `x-api-key: INTERNAL_API_KEY` | Confidential bet API: encrypts bet via FHE mock (pre-alpha) then submits to `confidential_market` program. Actions: `place_bet` |
| `POST /api/commands/solana-resolve` | `INTERNAL_API_KEY` env var | Oracle automation: calls 0G ServingBroker via `callAgent()` → `commit_vote` → `reveal_vote` → `resolve_market` → `settle_reputation`. Has `skipOnChain=true` mode for offline demos. |
| `POST /api/commands/minikit-dispute` | (internal only) | Thin proxy to `solana-resolve` for dispute UI. Reformats response to `DisputeResolution` component shape: `{ round1: { tally, reveals }, consensus, resolved }` |
| `POST /api/commands/generate-insights` | (stub) | Returns `{ wordCloud: [], references: [] }`. Prevents `fetchInsights` crash when OpenAI is unavailable |
| `GET /api/markets` | none | Returns market list. Falls back to 6 devnet fixture markets when no real on-chain markets exist |

## On-chain Program

Program ID (devnet): `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx`

### PDA seeds

| Account | Seeds |
|---|---|
| Market | `["market", market_id_bytes]` |
| Vault | `["vault", market_pubkey]` |
| BetEscrow | `["bet", market_pubkey, bettor_pubkey]` |
| Agent | `["agent", authority_pubkey]` |
| Reputation | `["reputation", agent_pubkey]` |
| VoteRecord | `["vote", market_pubkey, agent_pubkey, round]` |
| AttestationRecord | `["attestation", market_pubkey, agent_pubkey, round]` |

### Market lifecycle

1. `create_market` → Market PDA + vault
2. `place_bet` → SPL tokens → vault, creates BetEscrow
3. `commit_deadline` passes → `commit_vote` window opens
4. `reveal_deadline` passes → `reveal_vote` window
5. `resolve_market` → tallies votes, sets outcome
6. `claim_payout` → winners withdraw proportional share from vault

### TEE Oracle flow

1. `solana-resolve.ts` calls `callAgent()` from `lib/0g-compute` → 0G ServingBroker (Galileo/TEE inference) → returns LLM verdict with evidence
2. In production: `lib/nitro.ts` `callNitroAgent()` calls Nitro enclave for TEE-attested inference (currently a standalone endpoint; not wired into `solana-resolve` yet)
3. Standard commit-reveal: `commit_hash = sha256([outcome_u8] || salt_32)` → `commit_vote` → `reveal_vote` → `resolve_market` → `settle_reputation`
4. Reputation: correct `+10`, wrong `−5` (floor 0)

### Instruction discriminators

| Instruction | Bytes |
|---|---|
| `place_bet` | `[222, 62, 67, 220, 63, 166, 126, 33]` |
| `claim_payout` | `[127, 240, 132, 62, 227, 198, 146, 133]` |
| Market account | `[47, 166, 112, 147, 155, 197, 86, 7]` |

## Programs

| Program | Devnet ID | Notes |
|---|---|---|
| `smith_oracle` (Anchor `dive_oracle`) | `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx` | IDL at `target/idl/smith_oracle.json` |
| `confidential_market` | `BB17yKcbp9qNyokaNPo29gjFK9aYBEH69wpQgiRPZhwz` | FHE-enabled betting. Confidential bet flow: client → API route → gRPC → program. Pre-alpha, encryption mocked. |

## Environment Variables

```
NITRO_ENCLAVE_ENDPOINT=https://...     # Nitro enclave HTTP endpoint
SOLANA_OPERATOR_SECRET_KEY=[...]       # Operator key (JSON array) — sole signer for agent actions
INTERNAL_API_KEY=...                  # API auth for bridge/resolve routes
NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID=CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_DEVNET_USDC_MINT=...      # Devnet USDC mint for betting (placeholder by default)
```

## Known Issues

- **`DEFAULT_MINT` placeholder** (`components/solana/PlaceBetModal.tsx`) — placeholder SPL token, not real devnet USDC. Set `NEXT_PUBLIC_DEVNET_USDC_MINT` before betting with real tokens.
- **PCR0/PCR1 not configured** — `verify_attestation` uses hardcoded zero expected values. After building the Nitro enclave binary, measure with `nitro-cli` and update the expected PCR values in the instruction call.
- **Certificate chain not verified** — `verify_attestation` skips the `certificate_chain` field. Enclave identity chain not verified on-chain.
- **Nitro enclave endpoint unauthenticated** — `NITRO_ENCLAVE_ENDPOINT` must be network-isolated (private VPC). Enclave unavailability fail-closes (503), not silent fallback.
- **Single operator wallet** — one key controls all agent actions. Per-agent keypairs needed before mainnet with real TVL.
- **`encrypt-pre-alpha/` excluded** — separate Rust workspace, `tsconfig.json` exclude pattern. Build separately.
- **EVM-era stubs** — `lib/prediction-market.ts`, `lib/sparkinft-abi.ts`, `lib/wagmi.ts`, `lib/contracts.ts`, `components/ConnectWallet.tsx` are deprecated stubs kept only to satisfy imports from legacy EVM-era pages (now excluded from type-checking). Do not use these in new code.

## Security Notes

- `solana-bridge`: requires `x-api-key: INTERNAL_API_KEY` header
- `solana-resolve`: requires `INTERNAL_API_KEY` env var (returns 500 if missing)
- `skipOnChain=true` still requires auth — inference runs but on-chain txs are skipped
- Operator key compromise = full system compromise
- `solana-resolve` response excludes `attestationDocument` — only `attestationHash` returned to caller