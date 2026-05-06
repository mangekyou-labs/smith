use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx");

const MAX_AGENT_NAME_LEN: usize = 64;
const MAX_URI_LEN: usize = 200;
const STATUS_OPEN: u8 = 0;
const STATUS_RESOLVED: u8 = 1;
const OUTCOME_NONE: u8 = 0;
const OUTCOME_YES: u8 = 1;
const OUTCOME_NO: u8 = 2;
const STARTING_REPUTATION: i64 = 10;
const CORRECT_REPUTATION_DELTA: i64 = 10;
const WRONG_REPUTATION_DELTA: i64 = 5;

#[program]
pub mod dive_oracle {
    use super::*;

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        metadata_uri: String,
        human_id_hash: [u8; 32],
    ) -> Result<()> {
        require!(name.len() <= MAX_AGENT_NAME_LEN, DiveError::NameTooLong);
        require!(metadata_uri.len() <= MAX_URI_LEN, DiveError::UriTooLong);
        require!(human_id_hash != [0; 32], DiveError::MissingHumanIdHash);

        let now = Clock::get()?.unix_timestamp;
        let agent = &mut ctx.accounts.agent;
        agent.authority = ctx.accounts.authority.key();
        agent.human_id_hash = human_id_hash;
        agent.name = name;
        agent.metadata_uri = metadata_uri;
        agent.registered_at = now;
        agent.bump = ctx.bumps.agent;

        let reputation = &mut ctx.accounts.reputation;
        reputation.agent = agent.key();
        reputation.score = STARTING_REPUTATION;
        reputation.total_votes = 0;
        reputation.correct_votes = 0;
        reputation.bump = ctx.bumps.reputation;

        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: [u8; 32],
        question_uri: String,
        min_votes: u16,
        consensus_bps: u16,
        commit_deadline: i64,
        reveal_deadline: i64,
    ) -> Result<()> {
        require!(question_uri.len() <= MAX_URI_LEN, DiveError::UriTooLong);
        require!(min_votes > 0, DiveError::InvalidMinVotes);
        require!(
            (5_001..=10_000).contains(&consensus_bps),
            DiveError::InvalidConsensusThreshold
        );

        let now = Clock::get()?.unix_timestamp;
        require!(commit_deadline > now, DiveError::InvalidDeadline);
        require!(
            reveal_deadline > commit_deadline,
            DiveError::InvalidDeadline
        );

        let market = &mut ctx.accounts.market;
        market.market_id = market_id;
        market.creator = ctx.accounts.creator.key();
        market.question_uri = question_uri;
        market.status = STATUS_OPEN;
        market.min_votes = min_votes;
        market.consensus_bps = consensus_bps;
        market.commit_deadline = commit_deadline;
        market.reveal_deadline = reveal_deadline;
        market.total_commits = 0;
        market.total_reveals = 0;
        market.yes_reveals = 0;
        market.no_reveals = 0;
        market.resolved_outcome = OUTCOME_NONE;
        market.yes_pool = 0;
        market.no_pool = 0;
        market.bump = ctx.bumps.market;

        Ok(())
    }

    pub fn commit_vote(ctx: Context<CommitVote>, round: u8, commit_hash: [u8; 32]) -> Result<()> {
        require!(round > 0, DiveError::InvalidRound);
        require!(
            ctx.accounts.market.status == STATUS_OPEN,
            DiveError::MarketNotOpen
        );
        require!(
            Clock::get()?.unix_timestamp <= ctx.accounts.market.commit_deadline,
            DiveError::CommitWindowClosed
        );

        let vote_record = &mut ctx.accounts.vote_record;
        vote_record.market = ctx.accounts.market.key();
        vote_record.agent = ctx.accounts.agent.key();
        vote_record.authority = ctx.accounts.authority.key();
        vote_record.round = round;
        vote_record.commit_hash = commit_hash;
        vote_record.revealed = false;
        vote_record.outcome = OUTCOME_NONE;
        vote_record.salt = [0; 32];
        vote_record.evidence_hash = [0; 32];
        vote_record.settled = false;
        vote_record.bump = ctx.bumps.vote_record;

        let marker = &mut ctx.accounts.human_vote_marker;
        marker.market = ctx.accounts.market.key();
        marker.human_id_hash = ctx.accounts.agent.human_id_hash;
        marker.agent = ctx.accounts.agent.key();
        marker.bump = ctx.bumps.human_vote_marker;

        let market = &mut ctx.accounts.market;
        market.total_commits = market
            .total_commits
            .checked_add(1)
            .ok_or(DiveError::ArithmeticOverflow)?;

        Ok(())
    }

    pub fn reveal_vote(
        ctx: Context<RevealVote>,
        outcome: u8,
        salt: [u8; 32],
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        require!(is_binary_outcome(outcome), DiveError::InvalidOutcome);
        require!(
            ctx.accounts.market.status == STATUS_OPEN,
            DiveError::MarketNotOpen
        );

        let now = Clock::get()?.unix_timestamp;
        require!(
            now > ctx.accounts.market.commit_deadline,
            DiveError::RevealTooEarly
        );
        require!(
            now <= ctx.accounts.market.reveal_deadline,
            DiveError::RevealWindowClosed
        );

        let vote_record = &mut ctx.accounts.vote_record;
        require!(!vote_record.revealed, DiveError::AlreadyRevealed);
        require!(
            verify_commitment(outcome, &salt, &vote_record.commit_hash),
            DiveError::InvalidReveal
        );

        vote_record.revealed = true;
        vote_record.outcome = outcome;
        vote_record.salt = salt;
        vote_record.evidence_hash = evidence_hash;

        let market = &mut ctx.accounts.market;
        market.total_reveals = market
            .total_reveals
            .checked_add(1)
            .ok_or(DiveError::ArithmeticOverflow)?;

        match outcome {
            OUTCOME_YES => {
                market.yes_reveals = market
                    .yes_reveals
                    .checked_add(1)
                    .ok_or(DiveError::ArithmeticOverflow)?;
            }
            OUTCOME_NO => {
                market.no_reveals = market
                    .no_reveals
                    .checked_add(1)
                    .ok_or(DiveError::ArithmeticOverflow)?;
            }
            _ => return err!(DiveError::InvalidOutcome),
        }

        Ok(())
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == STATUS_OPEN, DiveError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp > market.reveal_deadline,
            DiveError::RevealWindowNotClosed
        );

        let outcome = consensus_outcome(
            market.total_reveals,
            market.yes_reveals,
            market.no_reveals,
            market.min_votes,
            market.consensus_bps,
        )
        .ok_or(DiveError::NoConsensus)?;

        market.status = STATUS_RESOLVED;
        market.resolved_outcome = outcome;

        Ok(())
    }

    pub fn settle_reputation(ctx: Context<SettleReputation>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(
            market.status == STATUS_RESOLVED,
            DiveError::MarketNotResolved
        );

        let vote_record = &mut ctx.accounts.vote_record;
        require!(vote_record.revealed, DiveError::VoteNotRevealed);
        require!(!vote_record.settled, DiveError::AlreadySettled);
        // Only the agent's authority can settle their own reputation
        require!(
            ctx.accounts.authority.key() == ctx.accounts.agent.authority,
            DiveError::Unauthorized
        );

        let reputation = &mut ctx.accounts.reputation;
        let correct = vote_record.outcome == market.resolved_outcome;
        if correct {
            reputation.score = reputation
                .score
                .checked_add(CORRECT_REPUTATION_DELTA)
                .ok_or(DiveError::ArithmeticOverflow)?;
            reputation.correct_votes = reputation
                .correct_votes
                .checked_add(1)
                .ok_or(DiveError::ArithmeticOverflow)?;
        } else {
            reputation.score = reputation
                .score
                .saturating_sub(WRONG_REPUTATION_DELTA)
                .max(0);
        }

        reputation.total_votes = reputation
            .total_votes
            .checked_add(1)
            .ok_or(DiveError::ArithmeticOverflow)?;
        vote_record.settled = true;

        Ok(())
    }

    /// Place a YES or NO bet by depositing SPL tokens into the market vault.
    pub fn place_bet(ctx: Context<PlaceBet>, outcome: u8, amount: u64) -> Result<()> {
        require!(is_binary_outcome(outcome), DiveError::InvalidOutcome);
        require!(amount > 0, DiveError::ZeroBetAmount);
        require!(
            ctx.accounts.market.status == STATUS_OPEN,
            DiveError::MarketNotOpen
        );
        require!(
            Clock::get()?.unix_timestamp <= ctx.accounts.market.commit_deadline,
            DiveError::BettingWindowClosed
        );

        // Transfer tokens from bettor → vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.bettor_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.bettor.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        // Record the bet
        let bet = &mut ctx.accounts.bet_escrow;
        bet.market = ctx.accounts.market.key();
        bet.bettor = ctx.accounts.bettor.key();
        bet.outcome = outcome;
        bet.amount = amount;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet_escrow;

        // Update market totals
        let market = &mut ctx.accounts.market;
        match outcome {
            OUTCOME_YES => {
                market.yes_pool = market
                    .yes_pool
                    .checked_add(amount)
                    .ok_or(DiveError::ArithmeticOverflow)?;
            }
            OUTCOME_NO => {
                market.no_pool = market
                    .no_pool
                    .checked_add(amount)
                    .ok_or(DiveError::ArithmeticOverflow)?;
            }
            _ => return err!(DiveError::InvalidOutcome),
        }

        Ok(())
    }

    /// Claim payout after market resolution. Winners receive a proportional
    /// share of the total pool (minus the losing side's contribution).
    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(
            market.status == STATUS_RESOLVED,
            DiveError::MarketNotResolved
        );

        let bet = &mut ctx.accounts.bet_escrow;
        require!(!bet.claimed, DiveError::AlreadyClaimed);
        require!(
            bet.outcome == market.resolved_outcome,
            DiveError::BetDidNotWin
        );

        // Proportional payout: bettor_share = bet.amount * total_pool / winning_pool
        let total_pool = market
            .yes_pool
            .checked_add(market.no_pool)
            .ok_or(DiveError::ArithmeticOverflow)?;
        let winning_pool = if market.resolved_outcome == OUTCOME_YES {
            market.yes_pool
        } else {
            market.no_pool
        };
        require!(winning_pool > 0, DiveError::ArithmeticOverflow);

        let payout = (bet.amount as u128)
            .checked_mul(total_pool as u128)
            .ok_or(DiveError::ArithmeticOverflow)?
            .checked_div(winning_pool as u128)
            .ok_or(DiveError::ArithmeticOverflow)? as u64;

        bet.claimed = true;

        // Transfer from vault → bettor using vault PDA as signer
        let market_id = market.market_id;
        let vault_bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", market_id.as_ref(), &[vault_bump]];
        let signer_seeds = &[seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.bettor_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, payout)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Agent::INIT_SPACE,
        seeds = [b"agent", authority.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, Agent>,
    #[account(
        init,
        payer = authority,
        space = 8 + Reputation::INIT_SPACE,
        seeds = [b"reputation", agent.key().as_ref()],
        bump
    )]
    pub reputation: Account<'info, Reputation>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

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
    #[account(
        init,
        payer = authority,
        space = 8 + HumanVoteMarker::INIT_SPACE,
        seeds = [
            b"human-vote",
            market.key().as_ref(),
            agent.human_id_hash.as_ref()
        ],
        bump
    )]
    pub human_vote_marker: Account<'info, HumanVoteMarker>,
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

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct SettleReputation<'info> {
    pub market: Account<'info, Market>,
    #[account(has_one = authority)]
    pub agent: Account<'info, Agent>,
    #[account(
        mut,
        has_one = market,
        has_one = agent,
        seeds = [b"vote", market.key().as_ref(), agent.key().as_ref(), &[vote_record.round]],
        bump = vote_record.bump
    )]
    pub vote_record: Account<'info, VoteRecord>,
    #[account(
        mut,
        seeds = [b"reputation", agent.key().as_ref()],
        bump = reputation.bump
    )]
    pub reputation: Account<'info, Reputation>,
    pub authority: Signer<'info>,
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
pub struct Market {
    pub market_id: [u8; 32],
    pub creator: Pubkey,
    #[max_len(200)]
    pub question_uri: String,
    pub status: u8,
    pub min_votes: u16,
    pub consensus_bps: u16,
    pub commit_deadline: i64,
    pub reveal_deadline: i64,
    pub total_commits: u32,
    pub total_reveals: u32,
    pub yes_reveals: u32,
    pub no_reveals: u32,
    pub resolved_outcome: u8,
    /// Total SPL tokens bet on YES
    pub yes_pool: u64,
    /// Total SPL tokens bet on NO
    pub no_pool: u64,
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
    pub revealed: bool,
    pub outcome: u8,
    pub salt: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub settled: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct HumanVoteMarker {
    pub market: Pubkey,
    pub human_id_hash: [u8; 32],
    pub agent: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Reputation {
    pub agent: Pubkey,
    pub score: i64,
    pub total_votes: u32,
    pub correct_votes: u32,
    pub bump: u8,
}

/// Records a single bettor's position in a market.
#[account]
#[derive(InitSpace)]
pub struct BetEscrow {
    pub market: Pubkey,
    pub bettor: Pubkey,
    /// OUTCOME_YES or OUTCOME_NO
    pub outcome: u8,
    /// Amount of SPL tokens deposited
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

// ─── Escrow context structs ───────────────────────────────────────────────────

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// Vault token account owned by the vault PDA
    #[account(
        init_if_needed,
        payer = bettor,
        token::mint = mint,
        token::authority = vault,
        seeds = [b"vault", market.market_id.as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    /// Bettor's source token account
    #[account(mut, token::mint = mint, token::authority = bettor)]
    pub bettor_token_account: Account<'info, TokenAccount>,
    /// One BetEscrow per bettor per market
    #[account(
        init,
        payer = bettor,
        space = 8 + BetEscrow::INIT_SPACE,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub bet_escrow: Account<'info, BetEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    pub market: Account<'info, Market>,
    /// Vault PDA — authority over the vault token account
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
        seeds = [b"vault", market.market_id.as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    /// Bettor's destination token account
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
    pub mint: Account<'info, Mint>,
    pub bettor: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum DiveError {
    #[msg("Agent name exceeds maximum length")]
    NameTooLong,
    #[msg("URI exceeds maximum length")]
    UriTooLong,
    #[msg("Agent registration requires a non-zero human ID hash")]
    MissingHumanIdHash,
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
    #[msg("Vote has not been revealed")]
    VoteNotRevealed,
    #[msg("Reputation already settled for this vote")]
    AlreadySettled,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Invalid voting round")]
    InvalidRound,
    #[msg("Bet amount must be greater than zero")]
    ZeroBetAmount,
    #[msg("Betting window is closed")]
    BettingWindowClosed,
    #[msg("Payout already claimed")]
    AlreadyClaimed,
    #[msg("Bet outcome did not match the resolved outcome")]
    BetDidNotWin,
    #[msg("Reveal window has not closed yet — wait until after reveal_deadline")]
    RevealWindowNotClosed,
    #[msg("Caller is not authorized to perform this action")]
    Unauthorized,
}

pub fn commitment_hash(outcome: u8, salt: &[u8; 32]) -> [u8; 32] {
    hashv(&[&[outcome], salt]).to_bytes()
}

pub fn verify_commitment(outcome: u8, salt: &[u8; 32], commit_hash: &[u8; 32]) -> bool {
    commitment_hash(outcome, salt) == *commit_hash
}

pub fn consensus_outcome(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commitment_hash_round_trips() {
        let salt = [7; 32];
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

    // ── Payout math tests ────────────────────────────────────────────────────

    fn payout(bet_amount: u64, yes_pool: u64, no_pool: u64, winner: u8) -> u64 {
        let total_pool = yes_pool + no_pool;
        let winning_pool = if winner == OUTCOME_YES { yes_pool } else { no_pool };
        ((bet_amount as u128) * (total_pool as u128) / (winning_pool as u128)) as u64
    }

    #[test]
    fn payout_winner_takes_all_when_only_side() {
        // 100 tokens bet YES, 0 bet NO → YES wins, bettor gets 100 back
        let p = payout(100, 100, 0, OUTCOME_YES);
        assert_eq!(p, 100);
    }

    #[test]
    fn payout_proportional_split() {
        // 100 YES, 100 NO → total 200; YES wins; bettor with 50 YES gets 100
        let p = payout(50, 100, 100, OUTCOME_YES);
        assert_eq!(p, 100);
    }

    #[test]
    fn payout_minority_winner_gets_more() {
        // 25 YES, 75 NO → total 100; YES wins; bettor with 25 YES gets 100
        let p = payout(25, 25, 75, OUTCOME_YES);
        assert_eq!(p, 100);
    }

    #[test]
    fn payout_partial_yes_bet() {
        // 200 YES, 100 NO → total 300; YES wins; bettor with 100 YES gets 150
        let p = payout(100, 200, 100, OUTCOME_YES);
        assert_eq!(p, 150);
    }

    #[test]
    fn payout_no_side_wins() {
        // 100 YES, 200 NO → total 300; NO wins; bettor with 100 NO gets 150
        let p = payout(100, 100, 200, OUTCOME_NO);
        assert_eq!(p, 150);
    }
}
