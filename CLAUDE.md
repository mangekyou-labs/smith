# CLAUDE.md

Smith is a Solana-native prediction market powered by AI agent oracles on 0G Compute.

## Stack

- **Solana Devnet** — Anchor program (`smith_oracle`) for market accounts, escrow, voting
- **0G Galileo** — iNFT agents, TEE inference via `@0glabs/0g-serving-broker`
- **Next.js** (Pages Router) — Frontend, wallet adapter, on-chain reads

## Key Commands

```bash
npm run dev      # Start Next.js on localhost:3000
npm run build    # Production build
```

## Program

- Program ID: `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx` (devnet)
- IDL: `target/idl/smith_oracle.json`
- Market discriminator: `[219, 190, 213, 55, 0, 227, 198, 154]`

## Key Files

| File | Purpose |
|---|---|
| `lib/solana/smith-oracle.ts` | Program constants, PDA derivations, vote helpers |
| `lib/solana/tx-builders.ts` | Raw instruction builders for place_bet, claim_payout |
| `lib/solana/market-index.ts` | `getProgramAccounts` scanner + 30s cache |
| `lib/solana/price-utils.ts` | formatTokenAmount, formatUSD, CoinGecko fetch |
| `lib/0g-compute.ts` | 0G ServingBroker, `callAgent()` for TEE inference |
| `pages/api/commands/solana-bridge.ts` | Operator write API (register_agent, create_market, resolve, commit, reveal) |
| `pages/api/commands/solana-resolve.ts` | Oracle automation: committee inference → commit → reveal → settle |

## Environment Variables

```
ZG_STORAGE_PRIVATE_KEY=...      # 0G wallet (hex, no 0x prefix) — for iNFT + inference
ZG_RPC_URL=https://rpc.0gai.com  # 0G Galileo testnet RPC
SOLANA_OPERATOR_SECRET_KEY=[...] # Solana operator key (JSON array)
INTERNAL_API_KEY=...             # API auth for bridge routes
NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID=CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
```

## Architecture

### Market Flow

1. Create market → Market PDA (seeds: `["market", market_id_bytes]`)
2. User places bet → tokens escrowed in vault PDA (seeds: `["vault", market_id_bytes]`)
3. BetEscrow PDA (seeds: `["bet", market_pda, bettor_pda]`) tracks each position
4. After reveal deadline → resolve market → winners claim payout

### Oracle Resolution Flow

1. `solana-resolve` selects reputation-weighted committee
2. Each agent calls `broker.inference()` via 0G ServingBroker (TEE)
3. Agents compute commit hash: `sha256([outcome_u8] || salt_32)`
4. Submit `commit_vote` on-chain (operator signs)
5. Submit `reveal_vote` on-chain
6. `resolve_market` called (permissionless after deadline)
7. `settle_reputation` updates agent reputation on-chain