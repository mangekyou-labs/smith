import type { NextApiRequest, NextApiResponse } from "next";
import { Connection } from "@solana/web3.js";
import { getMarketAccounts, MarketAccount } from "@/lib/solana/market-index";

const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";

// Devnet fixture markets — returned when no real on-chain markets exist
// IDs are 32-byte hex (64 chars) for on-chain PDA compatibility
const DEVNET_FIXTURES = [
  {
    id: "0000000000000000000000000000000000000000000000000000000000000001",
    created_at: new Date(Date.now() - 86400000).toISOString(),
    ai_insight: { agent_id: "AlphaOracle", confidence_score: 0.72, suggested_categories: ["geopolitical"] },
    resolution: { question: "Will the EU finalize the AI Act by Oct 2026?", resolution_date: "", resolution_criteria: "Official EU Commission announcement" },
    amm: { current_odds_yes: 0.52 },
    ux: { status: "PROPOSED" },
    settlement: { winning_outcome: null },
  },
  {
    id: "0000000000000000000000000000000000000000000000000000000000000002",
    created_at: new Date(Date.now() - 172800000).toISOString(),
    ai_insight: { agent_id: "BetaAnalyst", confidence_score: 0.65, suggested_categories: ["cryptocurrency"] },
    resolution: { question: "Will BTC exceed $100k by end of 2026?", resolution_date: new Date(Date.now() + 2592000000).toISOString(), resolution_criteria: "CoinGecko price at Dec 31 2026 23:59 UTC" },
    amm: { current_odds_yes: 0.38 },
    ux: { status: "RESOLVED" },
    settlement: { winning_outcome: "YES" },
  },
  {
    id: "0000000000000000000000000000000000000000000000000000000000000003",
    created_at: new Date(Date.now() - 43200000).toISOString(),
    ai_insight: { agent_id: "DeltaCritic", confidence_score: 0.81, suggested_categories: ["geopolitical"] },
    resolution: { question: "Will global AI regulation framework emerge?", resolution_date: "", resolution_criteria: "UN or G7 official framework document" },
    amm: { current_odds_yes: 0.44 },
    ux: { status: "DISPUTED" },
    settlement: { winning_outcome: null },
  },
  {
    id: "0000000000000000000000000000000000000000000000000000000000000004",
    created_at: new Date(Date.now() - 259200000).toISOString(),
    ai_insight: { agent_id: "GammaOracle", confidence_score: 0.78, suggested_categories: ["geopolitical"] },
    resolution: { question: "Will Iran nuclear deal be reached?", resolution_date: new Date(Date.now() - 86400000).toISOString(), resolution_criteria: "JCPOA reactivation signed by all parties" },
    amm: { current_odds_yes: 0.29 },
    ux: { status: "RESOLVED" },
    settlement: { winning_outcome: "NO" },
  },
  {
    id: "0000000000000000000000000000000000000000000000000000000000000005",
    created_at: new Date(Date.now() - 7200000).toISOString(),
    ai_insight: { agent_id: "EpsilonPolicy", confidence_score: 0.69, suggested_categories: ["climate"] },
    resolution: { question: "Will WTI Oil stay above $80/barrel?", resolution_date: "", resolution_criteria: "WTI crude spot price > $80 on last trading day of month" },
    amm: { current_odds_yes: 0.61 },
    ux: { status: "PROPOSED" },
    settlement: { winning_outcome: null },
  },
  {
    id: "0000000000000000000000000000000000000000000000000000000000000006",
    created_at: new Date(Date.now() - 129600000).toISOString(),
    ai_insight: { agent_id: "ZetaSentinel", confidence_score: 0.75, suggested_categories: ["cryptocurrency"] },
    resolution: { question: "Will Ethereum flip BTC market cap by end of 2026?", resolution_date: "", resolution_criteria: "CoinGecko total market cap ETH > BTC for 30 consecutive days" },
    amm: { current_odds_yes: 0.18 },
    ux: { status: "RESOLVED" },
    settlement: { winning_outcome: "NO" },
  },
];

interface AIMarket {
  id: string;
  created_at: string;
  ai_insight: {
    agent_id: string;
    confidence_score: number;
    suggested_categories: string[];
  };
  resolution: {
    question: string;
    resolution_date: string;
    resolution_criteria: string;
  };
  amm: {
    current_odds_yes: number;
  };
  ux: {
    status: string;
  };
  settlement: {
    winning_outcome: string | null;
  };
}

function toAIMarket(m: MarketAccount): AIMarket {
  const statusMap: Record<number, string> = { 0: "PROPOSED", 1: "RESOLVED" };
  const yesNum = parseFloat(m.yesPool || "0");
  const noNum = parseFloat(m.noPool || "0");
  const total = yesNum + noNum;
  const oddsYes = total > 0 ? yesNum / total : 0.5;
  return {
    id: m.marketId,
    created_at: new Date().toISOString(),
    ai_insight: {
      agent_id: m.creator.slice(0, 8) + "...",
      confidence_score: 0.7,
      suggested_categories: ["cryptocurrency"],
    },
    resolution: {
      question: m.questionUri,
      resolution_date: "",
      resolution_criteria: "",
    },
    amm: { current_odds_yes: oddsYes },
    ux: { status: statusMap[m.status] ?? "PROPOSED" },
    settlement: { winning_outcome: null },
  };
}

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const markets = await getMarketAccounts(connection);
    res.setHeader("Cache-Control", "no-store");
    // Fallback to fixture data when no real markets exist on devnet
    if (markets.length === 0) {
      return res.json(DEVNET_FIXTURES);
    }
    return res.json(markets.map(toAIMarket));
  } catch {
    return res.status(200).json(DEVNET_FIXTURES);
  }
}
