# Deploy Oracle Agents (Smith / Solana)

Register oracle agents for the Smith prediction market. Each agent is backed by a 0G iNFT and resolves markets via on-chain commit-reveal voting.

---

## Credentials

| Credential | Required | Why |
|---|---|---|
| `ZG_STORAGE_PRIVATE_KEY` | **Yes** | Uploads agent config to 0G Storage, mints iNFT. Agent's core identity. |
| `SOLANA_OPERATOR_SECRET_KEY` | **Yes** | Signs Solana transactions for commit/reveal votes. |
| `INTERNAL_API_KEY` | **Yes** | Guards `/api/commands/*` routes. |
| `ZG_RPC_URL` | No | Defaults to `https://rpc.0gai.com` (0G Galileo testnet). |

---

## Step 1 — Fund wallets

**0G testnet (A0GI):** https://faucet.0g.ai — need ~10 A0GI for storage uploads + iNFT mints

**Solana devnet:** `solana airdrop 2` (or use Phantom faucet)

---

## Step 2 — Set `.env.local`

```bash
# 0G wallet (hex private key, no 0x prefix)
ZG_STORAGE_PRIVATE_KEY=your_hex_private_key

# 0G RPC (optional — defaults to public testnet)
ZG_RPC_URL=https://rpc.0gai.com

# Solana operator (JSON array from solana-keygen)
SOLANA_OPERATOR_SECRET_KEY=[12,34,56,...]

# API auth
INTERNAL_API_KEY=your_secret
```

---

## Step 3 — Start dev server

```bash
npm run dev
```

---

## Step 4 — Register agent on 0G + Solana

```bash
AGENT_NAME="AlphaOracle"
SOLANA_WALLET=$(solana-keygen pubkey ~/.config/solana/id.json)

curl -s -X POST http://localhost:3000/api/commands/solana-bridge \
  -H "Content-Type: application/json" \
  -H "x-api-key: $INTERNAL_API_KEY" \
  -d "{
    \"action\": \"register_agent\",
    \"name\": \"$AGENT_NAME\",
    \"metadataUri\": \"https://smith.oracle/agent/$AGENT_NAME\",
    \"humanIdHash\": \"$(openssl rand -hex 32)\"
  }" | python3 -m json.tool
```

Run for each agent: `AlphaOracle`, `BetaAnalyst`, `GammaWatcher`, `DeltaCritic`, `EpsilonPolicy`.

---

## Step 5 — Create test market

```bash
MARKET_ID=$(echo -n "Will BTC exceed 100k by end of 2025?" | openssl dgst -sha256 | awk '{print $2}')
COMMIT_DEADLINE=$(date -v+1d +%s)
REVEAL_DEADLINE=$(date -v+2d +%s)

curl -s -X POST http://localhost:3000/api/commands/solana-bridge \
  -H "Content-Type: application/json" \
  -H "x-api-key: $INTERNAL_API_KEY" \
  -d "{
    \"action\": \"create_market\",
    \"marketId\": \"$MARKET_ID\",
    \"questionUri\": \"Will BTC exceed \$100k by end of 2025?\",
    \"minVotes\": 3,
    \"consensusBps\": 7000,
    \"commitDeadline\": $COMMIT_DEADLINE,
    \"revealDeadline\": $REVEAL_DEADLINE
  }" | python3 -m json.tool
```

---

## Step 6 — Run oracle loop

```bash
curl -s -X POST http://localhost:3000/api/commands/solana-resolve \
  -H "Content-Type: application/json" \
  -H "x-api-key: $INTERNAL_API_KEY" \
  -d "{
    \"marketIdHex\": \"$MARKET_ID\",
    \"question\": \"Will BTC exceed \$100k by end of 2025?\",
    \"committeeSize\": 3,
    \"skipOnChain\": false
  }" | python3 -m json.tool
```

`skipOnChain: true` for dry-run (inference only, no Solana txs).

---

## Troubleshooting

| Error | Fix |
|---|---|
| `ZG_STORAGE_PRIVATE_KEY not set` | Add to `.env.local`, restart |
| `Token does not exist` | Check iNFT was minted on 0G — verify at https://0g.ai |
| `SOLANA_OPERATOR_SECRET_KEY not set` | Add JSON array from `cat ~/.config/solana/id.json` |
| `Market PDA not found` | Create market via Step 5 first |
| `All 0G Compute providers failed` | Check 0G testnet status at https://faucet.0g.ai |