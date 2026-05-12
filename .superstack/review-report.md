## Smith Oracle — Code Review

**Date:** 2026-05-07
**Reviewer:** review-and-iterate skill
**Program:** smith_oracle (devnet)
**Program ID:** `CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx`

---

## Scores

| Dimension | Score | Notes |
|---|---|---|
| Security | B | P0 all clear. 4 unfixed P2s in program. |
| Correctness | C | Frontend not reading on-chain market data. PlaceBet flow broken. Dispute wired to old API. |
| Error Handling | B | Good error codes, meaningful messages. |
| Testing | C | Unit tests exist (payout math). No fuzz/integration tests. |
| Code Organization | B | Clean separation: program, lib/solana, API routes. |
| Documentation | B | CLAUDE.md thorough. IDL generated. |

**Overall: B−** (75/100)

`ready_for_mainnet: false`

---

## Program: smith_oracle/src/lib.rs

### P0 — All Clear ✓

- `register_agent`: authority Signer ✓, PDA seeds ✓, no reinit ✓
- `create_market`: creator Signer ✓, deadline ordering ✓, `consensus_bps` range 5001–10000 ✓
- `commit_vote`: market status check ✓, commit_deadline ✓, checked_add total_commits ✓, HumanVoteMarker init ✓
- `reveal_vote`: timing enforced (after commit_deadline, before reveal_deadline) ✓, commitment verification ✓, checked_add ✓
- `resolve_market`: permissionless after reveal_deadline ✓, consensus_outcome helper ✓
- `settle_reputation`: authority signer check ✓, revealed/settled checks ✓, saturating_sub ✓
- `place_bet`: token::transfer with bettor authority ✓, init_if_needed vault ✓, checked_add pools ✓
- `claim_payout`: resolved check ✓, not-claimed ✓, outcome match ✓, vault PDA signer ✓
- Zero `.unwrap()` calls ✓
- Zero raw `AccountInfo` without type safety ✓
- 12+ `checked_*` operations throughout ✓

### P2 — Still Unfixed (from prior review)

**1. Payout u128→u64 truncation** (`lib.rs:341-345`)

```rust
let payout = (bet.amount as u128)
    .checked_mul(total_pool as u128)
    .ok_or(DiveError::ArithmeticOverflow)?
    .checked_div(winning_pool as u128)
    .ok_or(DiveError::ArithmeticOverflow)? as u64;
```

Large pools (e.g. 10M USDC with 6 decimals) can overflow u64 before division.
**Fix:** validate `payout <= u64::MAX` with `checked_mul` result, or use `TryFrom` error:

```rust
let payout = (bet.amount as u128)
    .checked_mul(total_pool as u128)
    .ok_or(DiveError::ArithmeticOverflow)?
    .checked_div(winning_pool as u128)
    .ok_or(DiveError::ArithmeticOverflow)?;
payout.try_into().map_err(|_| DiveError::ArithmeticOverflow)?
```

**2. VoteRecord not closed after settle** (`lib.rs:254`)

```rust
vote_record.settled = true; // account stays on-chain, rent drain
```

**Fix:** add `close = authority` to `SettleReputation` account, or add a separate `close_vote_record` instruction.

**3. No balance check in place_bet** (`lib.rs:281`)

`token::transfer` fails at runtime if bettor balance < amount. No user-friendly error.

**Fix:** read `bettor_token_account.amount` first:

```rust
let balance = ctx.accounts.bettor_token_account.amount;
require!(balance >= amount, DiveError::InsufficientFunds);
```

**4. Consensus minimum 5001 bps (50.01%)** (`lib.rs:62-65`)

Policy requires 7000 bps (70%). Current code allows 50.01%.

**Fix:** change lower bound to `7_000`:

```rust
require!((7_000..=10_000).contains(&consensus_bps), DiveError::InvalidConsensusThreshold);
```

---

## Frontend + Integration

### Critical: PlaceBet Flow Broken

**File:** `lib/solana/useTransactions.ts:33-48`

`usePlaceBet` calls `buildPlaceBetIx` directly and sends via `sendTransaction`. This constructs the raw instruction and sends it — but this approach does NOT include the `init_if_needed` vault creation properly because `buildPlaceBetIx` in `tx-builders.ts` hardcodes account keys without using Anchor's CPI for `init_if_needed`.

The vault PDA requires `init_if_needed` which needs the Anchor program to handle rent exemption and initialization. Raw instruction building skips this.

**Fix:** Use Anchor's program.methods for `place_bet`:

```typescript
const tx = await program.methods.placeBet(outcome, new BN(amount))
  .accounts({
    market: marketPda,
    vault: vaultPda,
    bettorTokenAccount: bettorTokenAccount,
    betEscrow: betEscrowPda,
    mint: mint,
    bettor: publicKey,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .transaction();
```

Or ensure `buildPlaceBetIx` correctly handles `init_if_needed` with proper account metas (the vault needs `is_signer: false` but Anchor handles this differently for CPI).

### Critical: Dispute Flow Calls Old API

**File:** `pages/dispute.tsx:232`

```typescript
const res = await fetch("/api/commands/resolve-1", { ... });
```

`/api/commands/resolve-1` runs inference but does NOT submit on-chain votes. The full on-chain flow is in `/api/commands/solana-resolve`.

**Fix:** Wire dispute button to `/api/commands/solana-resolve` instead, with `skipOnChain: false` when ready.

### High: market.tsx Mixes Mock + Real Data

**File:** `pages/market.tsx`

The page renders hardcoded static market cards alongside dynamic `AIMarketCard` components from `/api/markets`. The static cards pass hardcoded `marketIdHex` values like `"0000000000000000000000000000000000000000000000000000000000000001"` — these don't correspond to actual on-chain Market accounts.

This means:
- Static cards open the PlaceBetModal with non-existent market IDs
- `place_bet` would fail (market doesn't exist on-chain)

**Fix:** Replace static cards with real market data from `useMarkets()` hook.

### High: PlaceBetModal Mint Address is Placeholder

**File:** `components/solana/PlaceBetModal.tsx:27`

```typescript
const DEFAULT_MINT = "4zJfDU3X67bVxKqK6c6S6rX2bT8qJf9Yd6qZkLPj8Xz"; // devnet USDC placeholder
```

Must be replaced with a real SPL mint before any real betting can occur.

### Medium: 0G Agent Functions Return Stubs

**File:** `lib/0g-compute.ts:32-34`

```typescript
export function getMintedAgents(): AgentEntry[] {
  return []; // Always empty — no real agent registry
}
```

`selectCommittee` calls this, so committee is always empty in production.

`callAgent` makes a real 0G inference call, but `getMintedAgents` needs a real agent registry source (likely the on-chain Agent accounts via `getSolanaAgents`).

### Medium: RPC URL Inconsistency

| File | Variable |
|---|---|
| `lib/solana/useMarkets.ts` | `SOLANA_RPC_URL` from `NEXT_PUBLIC_SOLANA_RPC_URL` |
| `lib/solana/market-index.ts` | `RPC_URL` from `NEXT_PUBLIC_SOLANA_RPC_URL` |
| `lib/solana/useTransactions.ts` | `SOLANA_RPC_URL` from `useMarkets` import |
| `lib/0g-compute.ts` | `SOLANA_RPC_URL` from `NEXT_PUBLIC_SOLANA_RPC_URL` |

All consistent — good.

### Low: Unused getProgram() Stub

**File:** `lib/solana/tx-builders.ts:51-57`

```typescript
function getProgram(): Program<any> {
  return null as any; // Always returns null — dead code
}
```

No callers. Remove it.

### Low: Instruction Discriminators Hardcoded

**File:** `lib/solana/tx-builders.ts:86,119`

Discriminators `[222, 62, 67, 220, 63, 166, 126, 33]` and `[127, 240, 132, 62, 227, 198, 146, 133]` are hardcoded. These should come from the generated IDL to stay in sync after program changes.

**Fix:** Derive from `BorshCoder` or generated IDL:

```typescript
import idl from "@/target/idl/smith_oracle.json";
const coder = new BorshCoder(idl as any);
const disc = coder.instruction.get("placeBet")?.discriminator;
```

---

## Prior Review Findings — Status

| Finding | Status |
|---|---|
| Payout truncation | **Not fixed** |
| VoteRecord close | **Not fixed** |
| No balance check place_bet | **Not fixed** |
| Consensus min 5001 | **Not fixed** (still 5001) |
| Bet placement not wired to program | **Not fixed** |
| Dispute flow not connected | **Not fixed** |

---

## Test Coverage

- Unit tests: payout math (6 tests) ✓
- No fuzz tests (Trident)
- No integration tests (Surfpool)
- No on-chain program tests (LiteSVM)

---

## Summary of Fixes Needed Before Mainnet

| Priority | Issue | File |
|---|---|---|
| P2 | Payout u128→u64 validation | `lib.rs:341-345` |
| P2 | VoteRecord close after settle | `lib.rs:254` |
| P2 | Balance check before token transfer | `lib.rs:272` |
| P2 | Consensus min 7000 bps | `lib.rs:62-65` |
| P1 | PlaceBet uses raw ix (no Anchor CPI for init_if_needed) | `useTransactions.ts` |
| P1 | Dispute wired to resolve-1, not solana-resolve | `dispute.tsx:232` |
| P1 | Static market cards use fake market IDs | `market.tsx` |
| P2 | DEFAULT_MINT placeholder | `PlaceBetModal.tsx:27` |
| P2 | getMintedAgents returns [] | `lib/0g-compute.ts:32` |
| P3 | Remove dead `getProgram()` stub | `tx-builders.ts:51` |
| P3 | Derive discriminators from IDL | `tx-builders.ts:86` |
