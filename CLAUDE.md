# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Smith is a Solana-native prediction market powered by AI agent oracles running in **AWS Nitro Enclaves** (TEE). Agents produce TEE attestation proofs (PCR0/PCR1 measurements) verified on-chain in the `smith_oracle` program. Pari-mutuel betting — winners split the opposing pool.

## Stack

- **Solana Devnet** — Anchor program (`smith_oracle`) for market accounts, vault escrow, voting, TEE attestation verification
- **AWS Nitro Enclaves** — TEE environment for production inference via `lib/nitro.ts` (`callNitroAgent`). Agents wait for 1-click AWS setup + Gemini API keys from owner.
- **Next.js** (Pages Router) — Frontend with `@solana/wallet-adapter-react`; API routes for operator commands
- **Rust** — `programs/smith-oracle/` (Anchor), `programs/confidential-market/` (FHE, integrated via `confidentialMode` toggle in PlaceBetModal)

## Build Commands

```bash
npm run dev          # Start dev server on localhost:3000
npm run build        # Production build

npx tsc --noEmit     # TypeScript check (errors in encrypt-pre-alpha/ and programs/ OK to ignore)
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

`SolanaProvider` is client-only (never runs on server) because `@solana/wallet-adapter-wallets` transitively imports `@ledgerhq/errors` which fails in Node.js.

### Key frontend patterns

- **`PlaceBetModal`** — renders nothing when `open=false` (wrapper pattern). This prevents `useWallet()` from being called when modal is closed, which would throw without a provider. Hooks only run when `open=true`. Supports `confidentialMode` prop for encrypted betting.
- **`usePlaceBet(onSubmitted?)`** — accepts optional `onSubmitted` callback that fires when the transaction is submitted (before confirmation). Returns `BetTxResult` with `{ signature, state, error }`.
- **`useMarkets()`** — React Query wrapper around `getProgramAccounts` scanner. Caches for 30s.
- **`DisputeResolution`** (`components/DisputeResolution.tsx`) — dispute UI component. Calls `POST /api/commands/solana-resolve` with `skipOnChain=true` to run the 5-agent committee in prototype mode.

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
| `lib/solana/market-index.ts` | `getMarketAccounts()` — PDA scanner via `getProgramAccounts` + BorshCoder IDL deserialization. IDL loaded via `require("./smith_oracle.json")` — file committed to `lib/solana/` for Vercel compatibility. |
| `lib/solana/smith-oracle.ts` | PDA seeds (`vaultSeeds`, `betEscrowSeeds`), payout math, `SolanaOutcome` constants |
| `lib/solana/useMarkets.ts` | React Query hook for market list |
| `lib/solana/useTransactions.ts` | `usePlaceBet()` (returns `BetTxResult`), `useClaimPayout()` |
| `lib/solana/encrypt-grpc.ts` | FHE mock helpers: `encryptValue`, `bytesToHex`, `FHE_BOOL=0`, `FHE_UINT64=4`, `CONFIDENTIAL_MARKET_PROGRAM_ID` |
| `lib/nitro.ts` | `callNitroAgent(prompt)` — calls AWS Nitro enclave HTTP endpoint, returns `{response, attestation_document, hash}`. Also exports `extractVote(text)`, `hashResponse(text)`. |
| `lib/reputation.ts` | `selectCommittee()`, `updateReputation()`, `extractVote()`, `generateSolanaSalt()`. Pure local functions — no external API dependencies. |

### API routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/commands/solana-bridge` | `x-api-key: INTERNAL_API_KEY` | Operator write API: `register_agent`, `create_market`, `place_bet`, `claim_payout` |
| `POST /api/commands/confidential-market` | `x-api-key: INTERNAL_API_KEY` | Confidential bet API: encrypts bet via FHE mock (pre-alpha) then submits to `confidential_market` program |
| `POST /api/commands/solana-resolve` | `INTERNAL_API_KEY` env var | Oracle automation: calls Nitro enclave via `callNitroAgent()` → `commit_vote` → `reveal_vote` → `resolve_market` → `settle_reputation`. Has `skipOnChain=true` mode for offline demos. |
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

### TEE Oracle flow (AWS Nitro)

1. `solana-resolve` calls `callNitroAgent()` from `lib/nitro.ts` → Nitro enclave HTTP endpoint
2. Nitro enclave runs inference in TEE → returns `{response, attestation_document, hash}`
3. Attestation document contains PCR0/PCR1 measurements (verified off-chain for now)
4. Standard commit-reveal: `commit_hash = sha256([outcome_u8] || salt_32)` → `commit_vote` → `reveal_vote` → `resolve_market` → `settle_reputation`
5. Reputation: correct `+10`, wrong `−5` (floor 0)

### Instruction discriminators

| Instruction | Bytes |
|---|---|
| `place_bet` | `[222, 62, 67, 220, 63, 166, 126, 33]` |
| `claim_payout` | `[127, 240, 132, 62, 227, 198, 146, 133]` |
| Market account | `[47, 166, 112, 147, 155, 197, 86, 7]` |

## Programs

| Program | Devnet ID | Notes |
|---|---|---|
| `smith_oracle` (Anchor) | `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx` | IDL at `lib/solana/smith_oracle.json` |
| `confidential_market` | `BB17yKcbp9qNyokaNPo29gjFK9aYBEH69wpQgiRPZhwz` | FHE-enabled betting. Pre-alpha, encryption mocked. |

> **Note**: Anchor programs (`programs/smith-oracle/`, `programs/confidential-market/`) live in a separate workspace and are built independently.

## Environment Variables

```
NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID=CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_RPC_URL=https://api.devnet.solana.com

# Operator keypair for server-side bridge transactions (JSON array)
SOLANA_OPERATOR_SECRET_KEY=[...]

# Auth key for /api/commands routes
INTERNAL_API_KEY=...

# SPL USDC mint on devnet
NEXT_PUBLIC_DEVNET_USDC_MINT=...

# Nitro enclave endpoint (production)
NITRO_ENCLAVE_ENDPOINT=https://...
```

## Known Issues

- **`DEFAULT_MINT` placeholder** (`components/solana/PlaceBetModal.tsx`) — placeholder SPL token, not real devnet USDC. Set `NEXT_PUBLIC_DEVNET_USDC_MINT` before betting with real tokens.
- **`encrypt-pre-alpha/` excluded** — separate Rust workspace, `tsconfig.json` exclude pattern. Build separately.
- **`target/` directory excluded from Vercel** — IDL files committed to `lib/solana/` (`smith_oracle.json`, `confidential_market.json`). All `require()` calls use these committed files, not `target/idl/`.
- **`pages/api/commands/solana-resolve.ts`** — still uses runtime `fs` check for `process.cwd()` fallback path (non-blocking, works on Vercel).
- **Single operator wallet** — one key controls all agent actions. Per-agent keypairs needed before mainnet with real TVL.