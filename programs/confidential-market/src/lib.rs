// Copyright (c) dWallet Labs, Ltd.
// SPDX-License-Identifier: BSD-3-Clause-Clear

//! Confidential prediction market with FHE-encrypted bet amounts and pool sizes.
//!
//! ## Architecture
//!
//! - `Market` stores ciphertext account pubkeys for `yes_pool` and `no_pool`.
//! - `BetEscrow` stores the bettor's encrypted bet amount as a ciphertext account pubkey.
//! - Frontend encrypts bet amounts locally via `encryptValue()` and sends ciphertexts
//!   directly to the executor via gRPC-Web `createInput`.
//! - `place_bet` CPI runs the `cast_vote_graph` which conditionally increments pools.
//!
//! ## Instruction Discriminators
//!
//! | Disc | Instruction |
//! |------|-------------|
//! | 0 | `create_market` |
//! | 1 | `place_bet` |
//! | 2 | `claim_payout` |
//! | 3 | `resolve_market` |
//! | 4 | `commit_vote` |
//! | 5 | `reveal_vote` |

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use encrypt_anchor::EncryptContext;
use encrypt_dsl::prelude::encrypt_fn;

declare_id!("BB17yKcbp9qNyokaNPo29gjFK9aYBEH69wpQgiRPZhwz");

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_TITLE_LEN: usize = 200;
const MAX_DESCRIPTION_LEN: usize = 2000;
const STATUS_OPEN: u8 = 0;
const STATUS_RESOLVED: u8 = 1;
const OUTCOME_NONE: u8 = 0;
const OUTCOME_YES: u8 = 1;
const OUTCOME_NO: u8 = 2;

// ── Errors ─────────────────────────────────────────────────────────────────────

#[error_code]
pub enum ConfError {
    #[msg("Title exceeds maximum length")]
    TitleTooLong,
    #[msg("Description exceeds maximum length")]
    DescriptionTooLong,
    #[msg("Minimum vote count must be greater than zero")]
    InvalidMinVotes,
    #[msg("Consensus threshold must be >50% and <=100%")]
    InvalidConsensusThreshold,
    #[msg("Invalid commit/reveal deadline configuration")]
    InvalidDeadline,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Commit window is closed")]
    CommitWindowClosed,
    #[msg("Reveal attempted before commit deadline")]
    RevealTooEarly,
    #[msg("Reveal window is closed")]
    RevealWindowClosed,
    #[msg("Invalid vote outcome")]
    InvalidOutcome,
    #[msg("Vote has already been revealed")]
    AlreadyRevealed,
    #[msg("Reveal does not match commit hash")]
    InvalidReveal,
    #[msg("No consensus reached")]
    NoConsensus,
    #[msg("Market has not been resolved")]
    MarketNotResolved,
    #[msg("Bet amount must be greater than zero")]
    ZeroBetAmount,
    #[msg("Betting window is closed")]
    BettingWindowClosed,
    #[msg("Payout already claimed")]
    AlreadyClaimed,
    #[msg("Bet outcome did not match the resolved outcome")]
    BetDidNotWin,
    #[msg("Reveal window has not closed yet")]
    RevealWindowNotClosed,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Zero ciphertext ID")]
    ZeroCiphertextId,
    #[msg("Decryption not available")]
    DecryptionNotAvailable,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}

// ── FHE Graphs ─────────────────────────────────────────────────────────────────

/// cast_vote_graph: conditionally increment yes or no pool based on encrypted vote.
/// Inputs: yes_count, no_count, vote (EBool)
/// If vote=true → yes_count+1, no_count unchanged
/// If vote=false → yes_count unchanged, no_count+1
#[encrypt_fn]
fn cast_vote_graph(
    yes_count: EUint64,
    no_count: EUint64,
    vote: EBool,
) -> (EUint64, EUint64) {
    let new_yes = if vote { yes_count + 1 } else { yes_count };
    let new_no = if vote { no_count } else { no_count + 1 };
    (new_yes, new_no)
}

/// compute_payout_graph_yes: proportional payout assuming YES resolved as winner.
/// payout = bet_amount * (yes_pool + no_pool) / yes_pool
/// Only called by bettors who bet YES, after YES wins. Wrong-side calls revert in claim_payout.
#[encrypt_fn]
fn compute_payout_graph_yes(
    bet_amount: EUint64,
    yes_pool: EUint64,
    no_pool: EUint64,
) -> EUint64 {
    let total = yes_pool + no_pool;
    // Safe: if yes_pool == 0, division is undefined (no YES bets exist → payout 0)
    // claim_payout outcome check prevents wrong-side claims.
    let payout = bet_amount * (total / yes_pool);
    payout
}

/// compute_payout_graph_no: proportional payout assuming NO resolved as winner.
/// payout = bet_amount * (yes_pool + no_pool) / no_pool
#[encrypt_fn]
fn compute_payout_graph_no(
    bet_amount: EUint64,
    yes_pool: EUint64,
    no_pool: EUint64,
) -> EUint64 {
    let total = yes_pool + no_pool;
    let payout = bet_amount * (total / no_pool);
    payout
}

// ── Program ────────────────────────────────────────────────────────────────────

#[program]
pub mod confidential_market {
    use super::*;

    /// Create a new market with encrypted zero counters for yes/no pools.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: [u8; 32],
        title: String,
        description: String,
        min_votes: u16,
        consensus_bps: u16,
        commit_deadline: i64,
        reveal_deadline: i64,
        initial_yes_pool_id: [u8; 32],
        initial_no_pool_id: [u8; 32],
    ) -> Result<()> {
        require!(title.len() <= MAX_TITLE_LEN, ConfError::TitleTooLong);
        require!(description.len() <= MAX_DESCRIPTION_LEN, ConfError::DescriptionTooLong);
        require!(min_votes > 0, ConfError::InvalidMinVotes);
        require!(
            (7_000..=10_000).contains(&consensus_bps),
            ConfError::InvalidConsensusThreshold
        );

        let now = Clock::get()?.unix_timestamp;
        require!(commit_deadline > now, ConfError::InvalidDeadline);
        require!(reveal_deadline > commit_deadline, ConfError::InvalidDeadline);
        require!(initial_yes_pool_id != [0u8; 32], ConfError::ZeroCiphertextId);
        require!(initial_no_pool_id != [0u8; 32], ConfError::ZeroCiphertextId);

        let market = &mut ctx.accounts.market;
        market.market_id = market_id;
        market.creator = ctx.accounts.creator.key();
        market.title = title;
        market.description = description;
        market.status = STATUS_OPEN;
        market.min_votes = min_votes;
        market.consensus_bps = consensus_bps;
        market.commit_deadline = commit_deadline;
        market.reveal_deadline = reveal_deadline;
        market.total_bets = 0;
        market.total_commits = 0;
        market.total_reveals = 0;
        market.yes_reveals = 0;
        market.no_reveals = 0;
        market.resolved_outcome = OUTCOME_NONE;
        market.yes_pool_ct = initial_yes_pool_id;
        market.no_pool_ct = initial_no_pool_id;
        market.yes_tally_ct = [0u8; 32];
        market.no_tally_ct = [0u8; 32];
        market.bump = ctx.bumps.market;

        Ok(())
    }

    /// Place a bet. Frontend encrypts bet amount + vote locally via gRPC createInput.
    /// CPI into Encrypt executes cast_vote_graph which conditionally increments pools.
    pub fn place_bet(
        ctx: Context<PlaceBet>,
        outcome: u8,
        bet_ct_id: [u8; 32],
        vote_ct_id: [u8; 32],
        cpi_authority_bump: u8,
    ) -> Result<()> {
        require!(is_binary_outcome(outcome), ConfError::InvalidOutcome);
        require!(bet_ct_id != [0u8; 32], ConfError::ZeroCiphertextId);
        require!(vote_ct_id != [0u8; 32], ConfError::ZeroCiphertextId);

        let market = &ctx.accounts.market;
        require!(market.status == STATUS_OPEN, ConfError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp <= market.commit_deadline,
            ConfError::BettingWindowClosed
        );

        let encrypt_ctx = EncryptContext {
            encrypt_program: ctx.accounts.encrypt_program.to_account_info(),
            config: ctx.accounts.config.to_account_info(),
            deposit: ctx.accounts.deposit.to_account_info(),
            cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
            caller_program: ctx.accounts.caller_program.to_account_info(),
            network_encryption_key: ctx.accounts.network_encryption_key.to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            event_authority: ctx.accounts.event_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            cpi_authority_bump,
        };

        // Inputs: yes_pool_ct, no_pool_ct, vote_ct
        // Outputs (update-mode): yes_pool_ct, no_pool_ct
        let yes_ct = ctx.accounts.yes_pool_ct.to_account_info();
        let no_ct = ctx.accounts.no_pool_ct.to_account_info();
        let vote_ct = ctx.accounts.vote_ct.to_account_info();

        encrypt_ctx.cast_vote_graph(
            yes_ct.clone(), no_ct.clone(), vote_ct,
            yes_ct, no_ct,
        )?;

        let bet_escrow = &mut ctx.accounts.bet_escrow;
        bet_escrow.market = market.key();
        bet_escrow.bettor = ctx.accounts.bettor.key();
        bet_escrow.outcome = outcome;
        bet_escrow.bet_ct_id = bet_ct_id;
        bet_escrow.bump = ctx.bumps.bet_escrow;

        let market = &mut ctx.accounts.market;
        market.total_bets = market.total_bets.checked_add(1).ok_or(ConfError::ArithmeticOverflow)?;

        Ok(())
    }

    /// Bettor requests decryption of their encrypted bet amount.
    /// Must be called after market is resolved.
    pub fn request_bet_decryption(
        ctx: Context<RequestBetDecryption>,
        cpi_authority_bump: u8,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.status == STATUS_RESOLVED, ConfError::MarketNotResolved);

        let bet = &mut ctx.accounts.bet_escrow;
        require!(!bet.claimed, ConfError::AlreadyClaimed);
        require!(!bet.pending_bet_digest_set, ConfError::DecryptionNotAvailable);

        let encrypt_ctx = EncryptContext {
            encrypt_program: ctx.accounts.encrypt_program.to_account_info(),
            config: ctx.accounts.config.to_account_info(),
            deposit: ctx.accounts.deposit.to_account_info(),
            cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
            caller_program: ctx.accounts.caller_program.to_account_info(),
            network_encryption_key: ctx.accounts.network_encryption_key.to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            event_authority: ctx.accounts.event_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            cpi_authority_bump,
        };

        // Request decryption of the bet amount ciphertext
        let digest = encrypt_ctx.request_decryption(
            &ctx.accounts.request_acct.to_account_info(),
            &ctx.accounts.bet_ct.to_account_info(),
        )?;

        bet.pending_bet_digest = digest;
        bet.pending_bet_digest_set = true;

        Ok(())
    }

    /// Request decryption of the FHE-computed payout ciphertext.
    /// Must be called after the market is resolved and bettor's outcome matches the winner.
    pub fn request_payout_decryption(
        ctx: Context<RequestPayoutDecryption>,
        cpi_authority_bump: u8,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.status == STATUS_RESOLVED, ConfError::MarketNotResolved);

        let bet = &ctx.accounts.bet_escrow;
        require!(!bet.claimed, ConfError::AlreadyClaimed);
        require!(bet.pending_bet_digest_set, ConfError::DecryptionNotAvailable);

        let encrypt_ctx = EncryptContext {
            encrypt_program: ctx.accounts.encrypt_program.to_account_info(),
            config: ctx.accounts.config.to_account_info(),
            deposit: ctx.accounts.deposit.to_account_info(),
            cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
            caller_program: ctx.accounts.caller_program.to_account_info(),
            network_encryption_key: ctx.accounts.network_encryption_key.to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            event_authority: ctx.accounts.event_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            cpi_authority_bump,
        };

        // Compute payout via FHE using the graph matching the bettor's predicted outcome.
        // Wrong outcome is already rejected in claim_payout before this is called.
        let bet_ct = ctx.accounts.bet_ct.to_account_info();
        let yes_pool_ct = ctx.accounts.yes_pool_ct.to_account_info();
        let no_pool_ct = ctx.accounts.no_pool_ct.to_account_info();
        let payout_ct = ctx.accounts.payout_ct.to_account_info();

        if bet.outcome == OUTCOME_YES {
            encrypt_ctx.compute_payout_graph_yes(
                bet_ct.clone(),
                yes_pool_ct.clone(),
                no_pool_ct.clone(),
                payout_ct.clone(),
            )?;
        } else {
            encrypt_ctx.compute_payout_graph_no(
                bet_ct.clone(),
                yes_pool_ct.clone(),
                no_pool_ct.clone(),
                payout_ct.clone(),
            )?;
        }

        // Request decryption of the computed payout
        let digest = encrypt_ctx.request_decryption(
            &ctx.accounts.request_acct.to_account_info(),
            &payout_ct,
        )?;

        // Store digest in BetEscrow for verification in claim_payout
        let bet = &mut ctx.accounts.bet_escrow;
        bet.pending_payout_digest = digest;
        bet.pending_payout_digest_set = true;

        Ok(())
    }

    /// Claim payout after decryption complete.
    /// Reads decrypted payout amount, verifies digest, transfers from vault.
    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.status == STATUS_RESOLVED, ConfError::MarketNotResolved);

        let bet = &mut ctx.accounts.bet_escrow;
        require!(!bet.claimed, ConfError::AlreadyClaimed);
        require!(bet.pending_payout_digest_set, ConfError::DecryptionNotAvailable);

        // Read and verify decrypted payout
        let req_data = ctx.accounts.request_acct.try_borrow_data()?;
        use encrypt_types::encrypted::Uint64;
        let value = encrypt_anchor::accounts::read_decrypted_verified::<Uint64>(
            &req_data,
            &bet.pending_payout_digest,
        )
        .map_err(|_| ConfError::DecryptionNotAvailable)?;

        let payout = *value as u64;
        require!(payout > 0, ConfError::ZeroBetAmount);

        bet.claimed = true;

        // Transfer from vault → bettor
        let seeds: &[&[u8]] = &[b"vault", &market.market_id, &[ctx.bumps.vault]];
        let signer_seeds = &[seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().key(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.bettor_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, payout)?;

        Ok(())
    }

    /// Resolve the market after reveal deadline.
    pub fn resolve_market(ctx: Context<ResolveMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == STATUS_OPEN, ConfError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp > market.reveal_deadline,
            ConfError::RevealWindowNotClosed
        );

        let outcome = consensus_outcome(
            market.total_reveals,
            market.yes_reveals,
            market.no_reveals,
            market.min_votes,
            market.consensus_bps,
        )
        .ok_or(ConfError::NoConsensus)?;

        market.status = STATUS_RESOLVED;
        market.resolved_outcome = outcome;

        Ok(())
    }

    /// Commit an agent vote.
    pub fn commit_vote(
        ctx: Context<CommitVote>,
        round: u8,
        commit_hash: [u8; 32],
        vote_ct_id: [u8; 32],
    ) -> Result<()> {
        require!(round > 0, ConfError::InvalidOutcome);
        let market = &ctx.accounts.market;
        require!(market.status == STATUS_OPEN, ConfError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp <= market.commit_deadline,
            ConfError::CommitWindowClosed
        );
        require!(vote_ct_id != [0u8; 32], ConfError::ZeroCiphertextId);

        let vote_record = &mut ctx.accounts.vote_record;
        vote_record.market = market.key();
        vote_record.agent = ctx.accounts.agent.key();
        vote_record.authority = ctx.accounts.authority.key();
        vote_record.round = round;
        vote_record.commit_hash = commit_hash;
        vote_record.vote_ct_id = vote_ct_id;
        vote_record.revealed = false;
        vote_record.outcome = OUTCOME_NONE;
        vote_record.bump = ctx.bumps.vote_record;

        let market = &mut ctx.accounts.market;
        market.total_commits = market.total_commits.checked_add(1).ok_or(ConfError::ArithmeticOverflow)?;

        Ok(())
    }

    /// Reveal a committed vote.
    pub fn reveal_vote(
        ctx: Context<RevealVote>,
        outcome: u8,
        salt: [u8; 32],
    ) -> Result<()> {
        require!(is_binary_outcome(outcome), ConfError::InvalidOutcome);
        let market = &ctx.accounts.market;
        require!(market.status == STATUS_OPEN, ConfError::MarketNotOpen);

        let now = Clock::get()?.unix_timestamp;
        require!(now > market.commit_deadline, ConfError::RevealTooEarly);
        require!(now <= market.reveal_deadline, ConfError::RevealWindowClosed);

        let vote_record = &mut ctx.accounts.vote_record;
        require!(!vote_record.revealed, ConfError::AlreadyRevealed);
        require!(
            verify_commitment(outcome, &salt, &vote_record.commit_hash),
            ConfError::InvalidReveal
        );

        vote_record.revealed = true;
        vote_record.outcome = outcome;
        vote_record.salt = salt;

        let market = &mut ctx.accounts.market;
        market.total_reveals = market.total_reveals.checked_add(1).ok_or(ConfError::ArithmeticOverflow)?;

        match outcome {
            OUTCOME_YES => {
                market.yes_reveals = market.yes_reveals.checked_add(1).ok_or(ConfError::ArithmeticOverflow)?;
            }
            OUTCOME_NO => {
                market.no_reveals = market.no_reveals.checked_add(1).ok_or(ConfError::ArithmeticOverflow)?;
            }
            _ => return err!(ConfError::InvalidOutcome),
        }

        Ok(())
    }
}

// ── Accounts ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(market_id: [u8; 32])]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", market_id.as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: yes_pool ciphertext account (input + output, update mode)
    #[account(mut)]
    pub yes_pool_ct: UncheckedAccount<'info>,
    /// CHECK: no_pool ciphertext account (input + output, update mode)
    #[account(mut)]
    pub no_pool_ct: UncheckedAccount<'info>,
    /// CHECK: bettor's encrypted vote ciphertext
    #[account(mut)]
    pub vote_ct: UncheckedAccount<'info>,
    #[account(
        init,
        payer = bettor,
        space = 8 + BetEscrow::INIT_SPACE,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub bet_escrow: Account<'info, BetEscrow>,
    #[account(mut, token::mint = mint, token::authority = bettor)]
    pub bettor_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    /// Encrypt CPI accounts
    /// CHECK: Encrypt program
    pub encrypt_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt config
    pub config: UncheckedAccount<'info>,
    /// CHECK: Encrypt deposit
    #[account(mut)]
    pub deposit: UncheckedAccount<'info>,
    /// CHECK: CPI authority PDA
    pub cpi_authority: UncheckedAccount<'info>,
    /// CHECK: Caller program
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: Network encryption key
    pub network_encryption_key: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Event authority PDA
    pub event_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// Vault token account owned by vault PDA
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
        seeds = [b"vault", market.market_id.as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: Bettor's destination token account
    #[account(mut, token::mint = mint, token::authority = bettor)]
    pub bettor_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        has_one = market,
        has_one = bettor,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump = bet_escrow.bump,
        close = bettor
    )]
    pub bet_escrow: Account<'info, BetEscrow>,
    /// CHECK: Completed decryption request account
    pub request_acct: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RequestBetDecryption<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        has_one = market,
        has_one = bettor,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump = bet_escrow.bump
    )]
    pub bet_escrow: Account<'info, BetEscrow>,
    /// CHECK: Decryption request account (created by encrypt program)
    #[account(mut)]
    pub request_acct: UncheckedAccount<'info>,
    /// CHECK: Bet amount ciphertext account
    pub bet_ct: UncheckedAccount<'info>,
    /// CHECK: Encrypt program
    pub encrypt_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt config
    pub config: UncheckedAccount<'info>,
    /// CHECK: Encrypt deposit
    #[account(mut)]
    pub deposit: UncheckedAccount<'info>,
    /// CHECK: CPI authority PDA
    pub cpi_authority: UncheckedAccount<'info>,
    /// CHECK: Caller program
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: Network encryption key
    pub network_encryption_key: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Event authority PDA
    pub event_authority: UncheckedAccount<'info>,
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestPayoutDecryption<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        has_one = market,
        has_one = bettor,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump = bet_escrow.bump
    )]
    pub bet_escrow: Account<'info, BetEscrow>,
    /// CHECK: Decryption request account (created by encrypt program)
    #[account(mut)]
    pub request_acct: UncheckedAccount<'info>,
    /// CHECK: Computed payout ciphertext account (output of compute_payout_graph)
    #[account(mut)]
    pub payout_ct: UncheckedAccount<'info>,
    /// CHECK: Bet amount ciphertext account
    pub bet_ct: UncheckedAccount<'info>,
    /// CHECK: YES pool ciphertext account
    pub yes_pool_ct: UncheckedAccount<'info>,
    /// CHECK: NO pool ciphertext account
    pub no_pool_ct: UncheckedAccount<'info>,
    /// CHECK: Encrypt program
    pub encrypt_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt config
    pub config: UncheckedAccount<'info>,
    /// CHECK: Encrypt deposit
    #[account(mut)]
    pub deposit: UncheckedAccount<'info>,
    /// CHECK: CPI authority PDA
    pub cpi_authority: UncheckedAccount<'info>,
    /// CHECK: Caller program
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: Network encryption key
    pub network_encryption_key: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Event authority PDA
    pub event_authority: UncheckedAccount<'info>,
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
#[instruction(round: u8)]
pub struct CommitVote<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(has_one = authority)]
    pub agent: Account<'info, Agent>,
    #[account(
        init,
        payer = authority,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [b"vote", market.key().as_ref(), agent.key().as_ref(), &[round]],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealVote<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(has_one = authority)]
    pub agent: Account<'info, Agent>,
    #[account(
        mut,
        has_one = market,
        has_one = agent,
        has_one = authority,
        seeds = [b"vote", market.key().as_ref(), agent.key().as_ref(), &[vote_record.round]],
        bump = vote_record.bump
    )]
    pub vote_record: Account<'info, VoteRecord>,
    pub authority: Signer<'info>,
}

// ── Account Types ─────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub market_id: [u8; 32],
    pub creator: Pubkey,
    #[max_len(200)]
    pub title: String,
    #[max_len(2000)]
    pub description: String,
    pub status: u8,
    pub min_votes: u16,
    pub consensus_bps: u16,
    pub commit_deadline: i64,
    pub reveal_deadline: i64,
    pub total_bets: u64,
    pub total_commits: u32,
    pub total_reveals: u32,
    pub yes_reveals: u32,
    pub no_reveals: u32,
    pub resolved_outcome: u8,
    /// Ciphertext account pubkey for encrypted YES pool counter
    pub yes_pool_ct: [u8; 32],
    /// Ciphertext account pubkey for encrypted NO pool counter
    pub no_pool_ct: [u8; 32],
    /// Encrypted tally counters for agent votes
    pub yes_tally_ct: [u8; 32],
    pub no_tally_ct: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BetEscrow {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub outcome: u8,
    /// Ciphertext account pubkey for the encrypted bet amount
    pub bet_ct_id: [u8; 32],
    pub claimed: bool,
    /// Digest from bet decryption request (for reveal verification)
    pub pending_bet_digest: [u8; 32],
    /// Whether a decryption request has been made
    pub pending_bet_digest_set: bool,
    /// Decrypted bet amount after reveal (u64)
    pub decrypted_bet_amount: u64,
    /// Digest from payout computation decryption request
    pub pending_payout_digest: [u8; 32],
    /// Whether payout decryption has been requested
    pub pending_payout_digest_set: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub authority: Pubkey,
    pub human_id_hash: [u8; 32],
    #[max_len(64)]
    pub name: String,
    #[max_len(200)]
    pub metadata_uri: String,
    pub registered_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VoteRecord {
    pub market: Pubkey,
    pub agent: Pubkey,
    pub authority: Pubkey,
    pub round: u8,
    pub commit_hash: [u8; 32],
    pub vote_ct_id: [u8; 32],
    pub revealed: bool,
    pub outcome: u8,
    pub salt: [u8; 32],
    pub bump: u8,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn commitment_hash(outcome: u8, salt: &[u8; 32]) -> [u8; 32] {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(&[outcome]);
    hasher.update(salt);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn verify_commitment(outcome: u8, salt: &[u8; 32], commit_hash: &[u8; 32]) -> bool {
    commitment_hash(outcome, salt) == *commit_hash
}

fn consensus_outcome(
    total_reveals: u32,
    yes_reveals: u32,
    no_reveals: u32,
    min_votes: u16,
    consensus_bps: u16,
) -> Option<u8> {
    if total_reveals < u32::from(min_votes) || yes_reveals == no_reveals {
        return None;
    }
    let (candidate, votes) = if yes_reveals > no_reveals {
        (OUTCOME_YES, yes_reveals)
    } else {
        (OUTCOME_NO, no_reveals)
    };
    let vote_bps = u128::from(votes) * 10_000;
    let required_bps = u128::from(total_reveals) * u128::from(consensus_bps);
    if vote_bps >= required_bps {
        Some(candidate)
    } else {
        None
    }
}

fn is_binary_outcome(outcome: u8) -> bool {
    outcome == OUTCOME_YES || outcome == OUTCOME_NO
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commitment_hash_round_trips() {
        let salt = [7u8; 32];
        let commit = commitment_hash(OUTCOME_YES, &salt);
        assert!(verify_commitment(OUTCOME_YES, &salt, &commit));
        assert!(!verify_commitment(OUTCOME_NO, &salt, &commit));
    }

    #[test]
    fn consensus_requires_min_votes() {
        assert_eq!(consensus_outcome(2, 2, 0, 3, 7_000), None);
    }

    #[test]
    fn consensus_requires_threshold() {
        assert_eq!(consensus_outcome(3, 2, 1, 3, 7_000), None);
        assert_eq!(consensus_outcome(4, 3, 1, 3, 7_000), Some(OUTCOME_YES));
    }

    #[test]
    fn consensus_rejects_ties() {
        assert_eq!(consensus_outcome(4, 2, 2, 3, 7_000), None);
    }

    #[test]
    fn binary_outcome_validation() {
        assert!(is_binary_outcome(OUTCOME_YES));
        assert!(is_binary_outcome(OUTCOME_NO));
        assert!(!is_binary_outcome(OUTCOME_NONE));
        assert!(!is_binary_outcome(3));
    }

    #[test]
    fn graph_shape() {
        let d = cast_vote_graph();
        let pg = encrypt_types::graph::parse_graph(&d).unwrap();
        assert_eq!(pg.header().num_inputs(), 3);
        assert_eq!(pg.header().num_outputs(), 2);
    }

    #[test]
    fn payout_graph_yes_shape() {
        let d = compute_payout_graph_yes();
        let pg = encrypt_types::graph::parse_graph(&d).unwrap();
        assert_eq!(pg.header().num_inputs(), 3);
        assert_eq!(pg.header().num_outputs(), 1);
    }

    #[test]
    fn payout_graph_no_shape() {
        let d = compute_payout_graph_no();
        let pg = encrypt_types::graph::parse_graph(&d).unwrap();
        assert_eq!(pg.header().num_inputs(), 3);
        assert_eq!(pg.header().num_outputs(), 1);
    }
}