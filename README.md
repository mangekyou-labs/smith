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

**Step 2 — TEE inference.** Each agent calls the AWS Nitro Enclave endpoint for TEE-attested inference. The enclave runs Gemini inside the Nitro VM and returns a verdict + evidence + attestation document (PCR0/PCR1 measurements).

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
     → AWS Nitro Enclave (TEE-attested Gemini inference)
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
- **AWS Nitro Enclaves** — TEE environment for production LLM inference (Gemini inside Nitro VM)
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

# AWS Nitro Enclave — TEE inference endpoint (production)
NITRO_ENCLAVE_ENDPOINT=https://your-enclave-endpoint.amazonaws.com/infer
```

---

## AWS Nitro Enclave — Agent Inference

Smith agents run LLM inference inside **AWS Nitro Enclaves** — hardware-isolated VM compartments where the enclave memory is encrypted with a per-enclave key inaccessible to the host. This provides **trusted execution environment (TEE)** attestation: clients can verify the enclave identity (PCR0/PCR1 measurements) before trusting the inference result.

### Architecture

```
API route (solana-resolve.ts)
    └─ callNitroAgent(prompt)          [lib/nitro.ts]
            └─ HTTP POST to Nitro endpoint
                    └─ Gemini runs inside Nitro VM
                            └─ { response, attestation_document, hash }
```

### Nitro response shape

```typescript
interface NitroAttestation {
  response: string;          // LLM verdict text, ends with "My vote: YES" or "My vote: NO"
  attestation_document: string; // base64 CBOR — contains PCR0/PCR1 + certificate chain
  hash: string;              // sha256 of response text
}
```

### Vote extraction

`extractVote(text)` parses `"My vote: YES"` or `"My vote: NO"` from the response using a regex. Response must end with this line.

### Attestation verification (future)

The `smith_oracle` program has a `verify_attestation` instruction that checks the Nitro attestation document (PCR0/PCR1 measurements) on-chain. Currently verification is off-chain; on-chain verification is planned.

### One-click AWS setup

Agents wait for 1-click AWS setup + Gemini API key from the owner. The Nitro enclave image (EIF) must be built and deployed to EKS or EC2 with Nitro Enclaves enabled before `NITRO_ENCLAVE_ENDPOINT` is functional.

### Adding new agents

Agents are identified by their `human_id_hash` — a 32-byte hash derived from their iNFT tokenId. The committee is selected by reputation-weighted random draw from all registered agents.

```typescript
// lib/reputation.ts
interface AgentEntry {
  displayName: string;
  inftTokenId: number | null;   // iNFT token ID on Solana
  reputation: number;            // starting score: 10
  humanId: string | null;       // 32-byte hex hash (used for HumanVoteMarker PDA)
  domainTags: string;            // e.g. "ai,research,politics"
}
```

Committee selection (reputation-weighted top-k):

```typescript
selectCommittee(agents: AgentEntry[], size: number): AgentEntry[]
// Sorts by reputation descending, returns top `size` agents
```

Current mock committee (hardcoded in `solana-resolve.ts`):

```typescript
const allAgents: AgentEntry[] = [
  { displayName: "AlphaOracle", inftTokenId: 2, reputation: 10, humanId: "0xabc", domainTags: "ai,research" },
  { displayName: "BetaAnalyst",  inftTokenId: 3, reputation: 10, humanId: "0xdef", domainTags: "ai,research" },
  { displayName: "GammaOracle",  inftTokenId: 4, reputation: 10, humanId: "0xghi", domainTags: "ai,research" },
  // ...
];
```

Replace this with a real on-chain agent registry scan via `getProgramAccounts` for production.

### Contrarian role

`solana-resolve.ts` assigns a **contrarian reviewer** role to every odd-indexed agent in the committee. This is a deliberate design: half the agents vote YES-proponent, half vote NO-proponent. The role is baked into the prompt sent to Nitro:

```
"You are a CONTRARIAN REVIEWER. Find every reason this should resolve NO."
"You are a PROPONENT REVIEWER. Find every reason this should resolve YES."
```

This forces evidence gathering from both sides before consensus is formed.

### Reputation system

| Event | Score delta |
|-------|-------------|
| Correct vote | +10 |
| Wrong vote | −5 (floor 0) |
| Starting score | 10 |

Reputation is stored on-chain in the `Reputation` PDA (`["reputation", agent_pubkey]`).

---

## API

---

## API

### Operator routes (requires INTERNAL_API_KEY)

| Route | Action |
|---|---|
| `POST /api/commands/solana-bridge` | register_agent, create_market, place_bet, claim_payout, commit, reveal, resolve, settle |
| `POST /api/commands/solana-resolve` | Run full oracle committee, commit/reveal, settle |
| `POST /api/commands/confidential-market` | FHE-encrypted betting (pre-alpha) |

### Market data

| Route | Purpose |
|---|---|
| `GET /api/markets` | List all on-chain markets |

---

## File map

```
lib/
  nitro.ts               # AWS Nitro Enclave client + extractVote
  reputation.ts          # selectCommittee, extractVote, updateReputation

lib/solana/
  smith-oracle.ts        # PDA seeds, payout math, SolanaOutcome constants
  market-index.ts        # getMarketAccounts() PDA scanner + BorshCoder deserialization
  tx-builders.ts         # Raw instruction builders (claim_payout IX)
  useMarkets.ts          # React Query hook for market list (30s cache)
  useTransactions.ts     # usePlaceBet(), useClaimPayout() mutations
  useBet.ts              # useBet hook
  encrypt-grpc.ts        # FHE mock helpers (pre-alpha confidential betting)
  price-utils.ts         # formatTokenAmount, formatUSD, CoinGecko fetch

pages/
  index.tsx              # Landing + market browser
  home.tsx               # Home / dashboard
  market.tsx             # Single market view + place bet modal
  agents.tsx             # Agent registry + reputation
  dispute.tsx            # DisputeResolution component (calls solana-resolve skipOnChain)
  dash.tsx               # Portfolio / positions
  api/
    commands/
      solana-bridge.ts       # Operator write API (register, create, bet, claim)
      solana-resolve.ts      # Oracle automation (committee → commit → reveal → resolve)
      confidential-market.ts # FHE betting API (pre-alpha)
      generate-insights.ts   # AI insight generation
      session/[id].ts       # Session management
    markets.ts               # Market list endpoint (GET)
```

---

## Program

Smith oracle program on devnet: `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx`

> **Note:** Anchor program IDL (committed to `lib/solana/smith_oracle.json`) is the authoritative source for instruction discriminators. Do not rely on hardcoded bytes in this README — generate them from the IDL.

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