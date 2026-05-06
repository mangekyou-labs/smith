# Smith — Solana Prediction Market

> *Predict. Win. Be Right.*

## What is Smith?

Smith is a Solana-native prediction market where anyone can trade on real-world outcomes. Markets resolve via AI agent oracles that research and vote on outcomes. Winners split the pool.

Unlike traditional prediction markets, Smith uses AI agents to resolve outcomes — eliminating the need for centralized reporters or slow dispute periods.

## How it works

### 1. Create a market

Any question with a clear YES/NO outcome and resolution date becomes a tradeable market. Markets are identified by a deterministic ID derived from the question text.

### 2. Trade

Users buy YES or NO shares by depositing SPL tokens into the market vault. Odds shift based on trading volume — the market is the oracle.

### 3. AI agents resolve

After the resolution date, a committee of AI agents researches the question and votes. Agents are selected by reputation. Votes are committed on-chain (hidden), then revealed and tallied.

### 4. Claim payout

If your side wins, you claim a proportional share of the opposing pool. If you predicted wrong, your tokens stay in the vault.

---

## Architecture

```
User → Solana Program (market accounts, vault escrow)
     → AI agents (off-chain inference, on-chain voting)
     → Resolution + payout
```

### Key accounts

| Account | PDA seeds | Purpose |
|---|---|---|
| Market | `["market", market_id_bytes]` | Market state, odds, deadlines |
| Vault | `["vault", market_id_bytes]` | SPL token escrow for the market |
| BetEscrow | `["bet", market_pubkey, bettor_pubkey]` | Tracks each user's position |
| Agent | `["agent", authority_pubkey]` | Agent identity + reputation |
| VoteRecord | `["vote", market_pubkey, agent_pubkey, round]` | Commit/reveal votes |

### Tech stack

- **Solana Devnet** — Anchor program for market accounts, voting, escrow
- **Next.js** (Pages Router) — Frontend, wallet adapter, on-chain reads
- **CoinGecko** — Price feeds for USD display

---

## Quick start

```bash
npm run dev
```

Open http://localhost:3000

### Environment variables

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_OPERATOR_SECRET_KEY=[...]
INTERNAL_API_KEY=[...]
NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID=CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
```

---

## API

### Operator routes (requires INTERNAL_API_KEY)

| Route | Action |
|---|---|
| `POST /api/commands/solana-bridge` | register_agent, create_market, resolve, commit, reveal |
| `POST /api/commands/solana-resolve` | Run full oracle committee, commit/reveal, settle |

### Market data

| Route | Purpose |
|---|---|
| `GET /api/markets` | List all on-chain markets |

---

## File map

```
lib/solana/
  smith-oracle.ts     # Program constants, PDA derivations, vote helpers
  tx-builders.ts      # Raw instruction builders (place_bet, claim_payout)
  market-index.ts     # getProgramAccounts scanner + cache
  price-utils.ts      # formatTokenAmount, formatUSD, CoinGecko fetch

pages/
  index.tsx           # Landing + market browser
  markets.tsx         # Full market list
  portfolio.tsx       # User positions
  api/
    commands/
      solana-bridge.ts   # Operator write API
      solana-resolve.ts  # Oracle automation
    markets.ts           # Market list endpoint
```

---

## Program

Smith oracle program on devnet: `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx`

Market discriminator: `[219, 190, 213, 55, 0, 227, 198, 154]`