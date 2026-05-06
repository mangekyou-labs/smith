# Smith — Solana Prediction Market

> *Predict. Win. Be Right.*

## What is Smith?

Smith is a Solana-native prediction market where anyone can trade on real-world outcomes. Markets resolve via AI agent oracles that research and vote on outcomes. Winners split the pool.

Unlike traditional prediction markets, Smith uses AI agents to resolve outcomes — eliminating the need for centralized reporters or slow dispute periods.

## How it works

### 1. Create a market

Any question with a clear YES/NO outcome and resolution date becomes a tradeable market. Markets are identified by a deterministic ID derived from the question text.

### 2. Trade (Conditional Tokens)

Users buy YES or NO **conditional tokens** by depositing SPL tokens into the market vault. Each market mints its own conditional token pair — YES tokens and NO tokens. When you buy 1 YES token for amount `A`, you deposit `A` SPL tokens and receive `A` YES tokens. The vault holds the escrowed SPL; your YES/NOs are tracked on-chain in the BetEscrow account.

**Payout is proportional (simple pari-mutuel), not LMSR.** When the market resolves YES, all YES token holders split the NO pool pro-rata. If you bet 100 tokens on YES and YES wins with a 100 YES / 200 NO pool (total 300), you receive `100 * 300 / 100 = 300` tokens — 2x return. Wrong side loses their deposit.

### 3. Oracle committee resolves

After the resolution date, the oracle committee runs:

**Step 1 — Committee selection.** The operator selects `min_votes` agents weighted by reputation score. Higher reputation = higher chance of being selected.

**Step 2 — TEE inference.** Each agent calls the 0G ServingBroker for TEE-attested inference on the question. Agents receive an LLM verdict + supporting evidence.

**Step 3 — Commit.** Each agent computes `commit_hash = sha256([outcome_u8] || salt_32_bytes)` and submits the hash on-chain via `commit_vote`. The actual vote is hidden at this stage. Agents use `human_id_hash` as identity proof to prevent double-voting.

**Step 4 — Reveal.** After the commit deadline, agents reveal their vote + salt via `reveal_vote`. The program verifies the reveal matches the committed hash using `verify_commitment(outcome, salt, commit_hash)`.

**Step 5 — Consensus.** `resolve_market` tallies revealed votes. If `yes_votes / total_reveals >= consensus_bps / 10000`, the market resolves YES. Otherwise NO. Ties or insufficient votes → no resolution.

**Step 6 — Reputation settle.** `settle_reputation` updates each agent's reputation on-chain: correct vote → `+10` score, wrong vote → `−5` score (floored at 0).

### 4. Claim payout

If your side wins, you call `claim_payout` to withdraw your proportional share from the vault. The program transfers `bet.amount * total_pool / winning_pool` SPL tokens to your wallet. Losers' deposits stay in the vault — they are the winners' payout.

---

## Architecture

```
User → Solana Program (market accounts, vault escrow)
     → 0G ServingBroker (TEE inference for agent committee)
     → AI agents vote commit/reveal on-chain
     → Resolution + payout
```

### Key accounts

| Account | PDA seeds | Purpose |
|---|---|---|
| Market | `["market", market_id_bytes]` | Market state, odds, deadlines |
| Vault | `["vault", market_id_bytes]` | SPL token escrow for the market |
| BetEscrow | `["bet", market_pubkey, bettor_pubkey]` | Tracks each user's position |
| Agent | `["agent", authority_pubkey]` | Agent identity + human ID hash |
| Reputation | `["reputation", agent_pubkey]` | Agent reputation score and vote stats |
| VoteRecord | `["vote", market_pubkey, agent_pubkey, round]` | Commit/reveal votes per round |
| HumanVoteMarker | `["human-vote", market_pubkey, human_id_hash]` | One vote per human per market |

### Dispute resolution

If `resolve_market` finds insufficient votes or no consensus threshold met, the market **remains open**. Users can continue trading until a new resolution round is triggered by the operator with updated deadlines. No automatic dispute escalation — operator initiates the next round.

### Tech stack

- **Solana Devnet** — Anchor program for market accounts, voting, escrow
- **0G Compute / Galileo** — TEE-attested LLM inference via `@0glabs/0g-serving-broker`
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

Market discriminator: `[222, 62, 67, 220, 63, 166, 126, 33]`

Bet discriminator: `[222, 62, 67, 220, 63, 166, 126, 33]`

Claim payout discriminator: `[127, 240, 132, 62, 227, 198, 146, 133]`

---

## Roadmap

### v2 — LMSR Conditional Token Market Maker

Current design: simple pari-mutuel proportional payout. Users deposit SPL, receive conditional tokens 1:1, winners split the opposing pool.

**v2 target:** Logarithmic Market Scoring Rule (LMSR) with standard conditional tokens — same mechanism as Augur/Gnosis Conditional Tokens.

Key changes:
- **Token model:** Each market mints YES/NO conditional tokens. Liquidity pool tracks `cost(q)` via `B * ln(e^(q YES / B) + e^(q NO / B))`. Users buy/sell at dynamic prices derived from the LMSR function — no fixed odds.
- **Market-making:** Protocol-owned liquidity (POL) or external LPs provide the initial liquidity pool. Market price emerges from trade volume, not just pool sizes.
- **Payout:** Tokens settle 1:1 to SPL at resolution. If YES resolves, YES tokens redeem for underlying SPL; NO tokens expire worthlessly (or vice versa).
- **Liquidity sensitivity:** Large trades move the price. This is the feature, not a bug — price = crowd belief.
- **Oracle unchanged:** Same commit/reveal committee, same reputation system. Only the trading/payout layer changes.

### v3 — Multi-outcome and Cross-market Positions

- Scalar markets (range outcomes, not binary)
- Portfolio margin: positions across multiple markets offset each other
- Agent reputation NFT as collateral for oracle bonds