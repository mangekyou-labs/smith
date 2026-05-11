import Head from 'next/head';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Header from '../components/header/Header';
import { PlaceBetModal } from '@/components/solana/PlaceBetModal';
import { Roboto, Figtree } from "next/font/google";

const roboto = Roboto({
    weight: ['400', '500', '700'],
    subsets: ['latin'],
    variable: '--font-roboto',
});

const figtree = Figtree({
    weight: ['400', '500', '600', '700'],
    subsets: ['latin'],
    variable: '--font-figtree',
});

// Reuse typography principles from index.tsx
const typography = {
    heroTitle: "font-[family-name:var(--font-roboto)] font-[700] text-[#ecfdf5] text-[clamp(2.25rem,6vw,4rem)] leading-tight tracking-tight",
    heroSub: "font-[family-name:var(--font-roboto)] font-[400] text-[#a7f3d0] text-[clamp(1.125rem,2vw,1.5rem)]",
    sectionHeader: "font-['Satoshi',sans-serif] font-[700] text-[#ecfdf5] text-3xl lg:text-4xl",
    smallLabel: "font-[family-name:var(--font-roboto)] font-[700] text-[#a7f3d0] text-[0.75rem] uppercase tracking-wide",
    tokenAmount: "font-mono font-[500] text-[#ecfdf5] text-[clamp(0.9rem,1.5vw,1.1rem)] outline-none",
    bodyText: "font-[family-name:var(--font-roboto)] font-[400] text-[#ecfdf5] text-[clamp(0.875rem,1vw,1rem)]",
    statusBadge: "font-[family-name:var(--font-roboto)] font-[600] text-[#10b981] bg-[#1a1a1a] border border-zinc-700 text-[0.7rem] px-2 py-1 rounded-md",
};

const marketFilters = [
    "All", "Trump", "NCAA Basketball", "Iran", "Oil", "Hungary Election", "Cuba", "Daily Temperature", "Tweet Markets", "Strait of Hormuz"
];

// Helper components for the Market grid
// Yes/No Button Pair
const YesNoButtons = ({
  yesPrice,
  noPrice,
  compact = false,
  onYes,
  onNo,
}: {
  yesPrice: number;
  noPrice: number;
  compact?: boolean;
  onYes?: () => void;
  onNo?: () => void;
}) => (
  <div className={`flex gap-1 ${compact ? 'w-24' : 'w-full'} shrink-0`}>
    <button
      onClick={onYes}
      className={`flex-1 flex justify-center items-center rounded-md font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 transition-colors ${compact ? 'text-base py-1.5' : 'text-lg py-2.5'}`}
    >
      Yes
    </button>
    <button
      onClick={onNo}
      className={`flex-1 flex justify-center items-center rounded-md font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors ${compact ? 'text-base py-1.5' : 'text-lg py-2.5'}`}
    >
      No
    </button>
  </div>
);

// Green/Red Up/Down Pair — opens YES modal for Up, NO for Down
const UpDownButtons = ({
  upPrice,
  downPrice,
  marketIdHex,
  marketQuestion,
}: {
  upPrice: number;
  downPrice: number;
  marketIdHex?: string;
  marketQuestion?: string;
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalOutcome, setModalOutcome] = useState<1 | 2>(1);
  const [modalMarketId, setModalMarketId] = useState("");
  const [modalQuestion, setModalQuestion] = useState("");

  const openYes = () => { setModalOutcome(1); setModalMarketId(marketIdHex ?? ""); setModalQuestion(marketQuestion ?? ""); setModalOpen(true); };
  const openNo = () => { setModalOutcome(2); setModalMarketId(marketIdHex ?? ""); setModalQuestion(marketQuestion ?? ""); setModalOpen(true); };

  return (
    <>
      <div className="flex gap-2 w-full mt-3">
        <button onClick={openYes} className="flex-1 flex justify-between items-center rounded-lg font-medium text-green-800 bg-green-100 hover:bg-green-200 px-3 py-2 transition-colors">
          <span>Up</span>
          <span className="text-base">+ ${upPrice}</span>
        </button>
        <button onClick={openNo} className="flex-1 flex justify-between items-center rounded-lg font-medium text-red-800 bg-red-100 hover:bg-red-200 px-3 py-2 transition-colors">
          <span>Down</span>
          <span className="text-base">+ ${downPrice}</span>
        </button>
      </div>
      <PlaceBetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        marketIdHex={modalMarketId || "0000000000000000000000000000000000000000000000000000000000000000"}
        outcome={modalOutcome}
        marketQuestion={modalQuestion}
      />
    </>
  );
};

// Team selection Pair — open YES modal for teamA, NO for teamB
const TeamButtons = ({
  teamA,
  teamB,
  marketIdHex,
  marketQuestion,
}: {
  teamA: string;
  teamB: string;
  marketIdHex?: string;
  marketQuestion?: string;
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalOutcome, setModalOutcome] = useState<1 | 2>(1);
  const [modalMarketId, setModalMarketId] = useState("");
  const [modalQuestion, setModalQuestion] = useState("");

  const openTeamA = () => { setModalOutcome(1); setModalMarketId(marketIdHex ?? ""); setModalQuestion(marketQuestion ?? ""); setModalOpen(true); };
  const openTeamB = () => { setModalOutcome(2); setModalMarketId(marketIdHex ?? ""); setModalQuestion(marketQuestion ?? ""); setModalOpen(true); };

  return (
    <>
      <div className="flex gap-2 w-full mt-3">
        <button onClick={openTeamA} className="flex-1 rounded-lg font-medium text-orange-900 bg-orange-100 hover:bg-orange-200 px-3 py-2.5 text-lg transition-colors truncate">
          {teamA}
        </button>
        <button onClick={openTeamB} className="flex-1 rounded-lg font-medium text-[#10b981] bg-[#1a1a1a] hover:bg-[#d1fae5] px-3 py-2.5 text-lg transition-colors truncate">
          {teamB}
        </button>
      </div>
      <PlaceBetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        marketIdHex={modalMarketId || "0000000000000000000000000000000000000000000000000000000000000000"}
        outcome={modalOutcome}
        marketQuestion={modalQuestion}
      />
    </>
  );
};


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

const statusColors: Record<string, string> = {
    PROPOSED: 'text-[#10b981] bg-[#1a1a1a] border-zinc-700',
    RESOLVED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    DISPUTED: 'text-amber-700 bg-amber-50 border-amber-200',
};

const categoryIcons: Record<string, string> = {
    climate: '🌍',
    geopolitical: '🌐',
    cryptocurrency: '₿',
    space: '🚀',
    AI: '🤖',
};

function AIMarketCard({
    market,
    onYes,
    onNo,
}: {
    market: AIMarket;
    onYes?: (id: string, question: string) => void;
    onNo?: (id: string, question: string) => void;
}) {
    const status = market.ux.status;
    const category = market.ai_insight.suggested_categories[0] || '';
    const icon = categoryIcons[category] || '📊';
    const yesPercent = Math.round(market.amm.current_odds_yes * 100);
    const isResolved = status === 'RESOLVED';
    const outcome = market.settlement.winning_outcome;

    return (
        <Link
            href={`/dispute?marketId=${market.id}`}
            className="bg-[#0a0a0a] rounded-xl shadow-zinc-800/50 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-zinc-800 p-6 flex flex-col transition-shadow duration-300 cursor-pointer group"
        >
            <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-slate-600 flex items-center justify-center shrink-0 shadow-zinc-800/50 border border-zinc-800 mt-0.5">
                    <span className="text-[18px]">{icon}</span>
                </div>
                <h3 className="font-['Satoshi'] font-semibold text-zinc-100 text-lg md:text-xl leading-tight group-hover:text-[#10b981] transition-colors">
                    {market.resolution.question}
                </h3>

            </div>

            <div className="flex flex-col gap-3 mt-auto">
                {isResolved && outcome ? (
                    <div className="flex items-center justify-between">
                        <span className="text-zinc-200 text-base font-medium">Outcome</span>
                        <span className={`font-bold text-lg ${outcome === 'YES' ? 'text-green-600' : 'text-red-600'}`}>
                            {outcome}
                        </span>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between">
                            <span className="text-zinc-200 text-base font-medium">Yes</span>
                            <div className="flex items-center gap-4">
                                <span className="font-semibold text-zinc-100 text-lg">{yesPercent}%</span>
                                <YesNoButtons
                                    yesPrice={0}
                                    noPrice={0}
                                    compact
                                    onYes={() => onYes?.(market.id, market.resolution.question)}
                                    onNo={() => onNo?.(market.id, market.resolution.question)}
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-zinc-200 text-base font-medium">No</span>
                            <div className="flex items-center gap-4">
                                <span className="font-semibold text-zinc-100 text-lg">{100 - yesPercent}%</span>
                                <YesNoButtons
                                    yesPrice={0}
                                    noPrice={0}
                                    compact
                                    onYes={() => onYes?.(market.id, market.resolution.question)}
                                    onNo={() => onNo?.(market.id, market.resolution.question)}
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>

            <div className="mt-8 pt-3 border-t border-zinc-800 flex items-center justify-between text-zinc-400 text-sm">
                <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${statusColors[status] || 'text-zinc-400 bg-[#0a0a0a] border-zinc-800'}`}>
                        {status}
                    </span>
                    <span className="text-zinc-400">{new Date(market.created_at).toLocaleDateString()}</span>
                </div>
                <span className="text-xs text-zinc-400">by {market.ai_insight.agent_id}</span>
            </div>
        </Link>
    );
}

export default function Market() {
    const [activeFilter, setActiveFilter] = useState("All");
    const [aiMarkets, setAiMarkets] = useState<AIMarket[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    // Bet modal state — shared across all card buttons
    const [modalOpen, setModalOpen] = useState(false);
    const [modalOutcome, setModalOutcome] = useState<1 | 2>(1);
    const [modalMarketId, setModalMarketId] = useState("");
    const [modalQuestion, setModalQuestion] = useState("");

    const openYes = (marketId: string, question: string) => {
        setModalOutcome(1);
        setModalMarketId(marketId);
        setModalQuestion(question);
        setModalOpen(true);
    };
    const openNo = (marketId: string, question: string) => {
        setModalOutcome(2);
        setModalMarketId(marketId);
        setModalQuestion(question);
        setModalOpen(true);
    };

    const fetchMarkets = useCallback(async () => {
        setRefreshing(true);
        try {
            const res = await fetch("/api/markets");
            const data = await res.json();
            if (Array.isArray(data)) {
                data.sort((a: AIMarket, b: AIMarket) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                setAiMarkets(data);
            }
        } catch { /* empty */ }
        setRefreshing(false);
    }, []);

    useEffect(() => { fetchMarkets(); }, [fetchMarkets]);

    return (
        <div className={`min-h-screen bg-[#0a0a0a] ${roboto.variable} ${figtree.variable} font-[family-name:var(--font-roboto)]`}>
            <Head>
                <title>Markets | Smith</title>
                <link href="https://api.fontshare.com/v2/css?f[]=satoshi@900,700,500,400,300&display=swap" rel="stylesheet" />
            </Head>

            {/* Reusing the Header exactly as index.tsx */}
            <Header />

            {/* Shared Bet Modal */}
            <PlaceBetModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                marketIdHex={modalMarketId || "0000000000000000000000000000000000000000000000000000000000000000"}
                outcome={modalOutcome}
                marketQuestion={modalQuestion}
            />

            <main className="w-[96%] max-w-[1800px] mx-auto mt-6 pb-16">

                {/* Header Row: Title & Actions */}
                <div className="flex items-center justify-between mb-6 px-2">
                    <div className="flex items-center gap-3">
                        <h1 className={typography.sectionHeader}>All markets</h1>
                        <button
                            onClick={fetchMarkets}
                            disabled={refreshing}
                            className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors text-zinc-400 disabled:opacity-50"
                            title="Refresh markets"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? 'animate-spin' : ''}>
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <polyline points="1 20 1 14 7 14"></polyline>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                        </button>
                    </div>
                    <div className="flex items-center gap-4 text-zinc-400">
                        <button className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        </button>
                        <button className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
                        </button>
                        <button className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
                        </button>
                    </div>
                </div>

                {/* Filter Pills */}
                <div className="flex overflow-x-auto gap-2 pb-4 mb-6 px-2 scrollbar-hide hide-scrollbar" style={{ msOverflowStyle: 'none', scrollbarWidth: 'none' }}>
                    {marketFilters.map((filter) => (
                        <button
                            key={filter}
                            onClick={() => setActiveFilter(filter)}
                            className={`whitespace-nowrap px-4 py-1.5 rounded-full text-base font-medium transition-colors border ${activeFilter === filter
                                ? 'bg-gray-800 text-white border-gray-800 shadow-md'
                                : 'bg-[#0a0a0a] text-zinc-200 border-gray-300 hover:bg-[#0a0a0a]'
                                }`}
                        >
                            {filter}
                        </button>
                    ))}
                </div>

                {/* Grid Container */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-6">

                    {/* AI Oracle Markets (dynamic from data/markets.json) */}
                    {aiMarkets.length === 0 ? (
                        <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
                            <div className="text-5xl mb-4">📊</div>
                            <h3 className="font-['Satoshi'] font-semibold text-zinc-100 text-xl mb-2">No markets yet</h3>
                            <p className="text-zinc-400 text-base max-w-sm">Markets will appear here once created on-chain, or check back after the oracle committee resolves active disputes.</p>
                        </div>
                    ) : aiMarkets.map((market) => (
                        <AIMarketCard key={market.id} market={market} onYes={openYes} onNo={openNo} />
                    ))}

                </div>
            </main>
        </div>
    );
}
