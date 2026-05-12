"use client";
import Head from 'next/head';
import { useState, useMemo } from 'react';
import { Roboto, Figtree } from "next/font/google";
import Header from '../components/header/Header';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useMarkets } from '@/lib/solana/useMarkets';
import { useWallet } from "@solana/wallet-adapter-react";

const Plasma = dynamic(() => import('../components/content/Plasma'), { ssr: false });

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

const typography = {
  heroTitle: "font-[family-name:var(--font-roboto)] font-[700] text-[#212529] text-[clamp(2.25rem,6vw,4rem)] leading-tight tracking-tight",
  heroSub: "font-[family-name:var(--font-roboto)] font-[400] text-[#6c757d] text-[clamp(1.125rem,2vw,1.5rem)]",
  sectionHeader: "font-[family-name:var(--font-roboto)] font-[500] text-[#212529] text-[clamp(1.25rem,3vw,1.75rem)] pb-2",
  smallLabel: "font-[family-name:var(--font-roboto)] font-[700] text-[#6c757d] text-[0.75rem] uppercase tracking-wide",
  tokenAmount: "font-mono font-[500] text-[#212529] text-[clamp(0.9rem,1.5vw,1.1rem)] outline-none",
  walletHash: "font-mono font-[400] text-[#066a9c] text-[clamp(0.8rem,1.2vw,0.9rem)] hover:text-[#0a58ca] hover:underline cursor-pointer transition-colors break-all",
  bodyText: "font-[family-name:var(--font-roboto)] font-[400] text-[#212529] text-[clamp(0.875rem,1vw,1rem)]",
  statusBadge: "font-[family-name:var(--font-roboto)] font-[600] text-[#066a9c] bg-[#e7f1f8] border border-[#b8d4e7] text-[0.7rem] px-2 py-1 rounded-md",
};

export default function ExplorerHome() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const { publicKey } = useWallet();
  const { data: markets } = useMarkets();

  const stats = useMemo(() => {
    if (!markets) return { activeMarkets: 0, isDemo: true };
    const active = markets.filter(
      (m: { status: number }) => m.status === 0 || m.status === 1 || m.status === 2
    ).length;
    return { activeMarkets: active ?? markets.length, isDemo: false };
  }, [markets]);

  const handleSearch = () => {
    const q = searchQuery.trim();
    if (!q) return;
    if (q.startsWith('mkt-')) {
      router.push(`/event?id=${q}`);
    } else if (q.startsWith('0.0.')) {
      router.push(`/dash?accountId=${q}`);
    } else {
      router.push(`/dash?name=${q}`);
    }
  };

  return (
    <div className={`min-h-screen bg-[#f8f9fa] ${roboto.variable} font-[family-name:var(--font-roboto)]`}>
      <Head>
        <title>Smith — Decentralized AI Prediction Market Explorer</title>
        <link href="https://api.fontshare.com/v2/css?f[]=satoshi@900,700,500,400,300&display=swap" rel="stylesheet" />
      </Head>

      <Header />

      {/* Hero Section */}
      <section className="w-[96%] max-w-[1800px] mx-auto mt-6 mb-10 pb-8">
        <div className="bg-[#111623] rounded-[1.5rem] relative overflow-hidden py-14 sm:py-20 px-6 lg:px-16 shadow-2xl mb-8">
          <div className="absolute inset-0 z-0 opacity-70">
            <Plasma color="#ffffff" speed={0.6} direction="forward" scale={2.6} opacity={0.5} mouseInteractive={true} />
          </div>
          <div className="relative z-10 flex flex-col items-center justify-center text-center max-w-[900px] mx-auto py-4">
            <h1 className="font-['Satoshi',sans-serif] text-[44px] md:text-[56px] font-medium tracking-tight text-white mb-4 drop-shadow-md">
              Smith Protocol Explorer
            </h1>
            <p className={`text-[20px] font-normal text-white/70 mb-10 max-w-[600px] mx-auto ${figtree.variable} font-[family-name:var(--font-figtree)]`}>
              AI-native prediction markets powered by decentralized oracle swarms.
            </p>

            <div className="flex w-full bg-white/70 backdrop-blur-xl bg-gradient-to-br from-white/90 to-white/50 rounded-full overflow-hidden shadow-[0_8px_32px_0_rgba(0,0,0,0.2)] border border-white/60 transition-all hover:shadow-[0_12px_40px_rgb(0,0,0,0.3)] hover:border-[#066a9c]/60 p-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search by Market ID (mkt-...) or Agent Name"
                className="flex-1 pl-8 pr-6 py-4 outline-none text-[#212529] placeholder-gray-400 min-w-0 font-sans text-[17px] bg-transparent"
              />
              <button onClick={handleSearch} className="bg-gray-400 hover:bg-gray-500 text-white px-10 py-3 rounded-full transition-colors flex items-center justify-center shadow-md">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="w-[96%] max-w-[1800px] mx-auto mt-[-80px] relative z-20 pb-16">

        {/* Global Stats Card */}
        <div className="bg-white rounded-xl shadow-[0_0.5rem_1rem_rgba(0,0,0,0.08)] border border-gray-200 mb-8 p-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-gray-200 overflow-hidden transform hover:-translate-y-1 transition-transform duration-300">

          {/* Active Markets */}
          <div className="p-6 flex flex-col justify-center bg-gradient-to-br from-white to-gray-50/50">
            <h2 className={`${typography.smallLabel} mb-3 flex items-center gap-2`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
              Active Markets
            </h2>
            <span className={typography.tokenAmount}>{stats.activeMarkets}</span>
            <span className={`${typography.bodyText} text-gray-500 text-sm mt-1`}>
              {stats.isDemo ? (
                <span className="text-amber-600 font-medium">Devnet Demo</span>
              ) : (
                <>On-chain</>
              )}
            </span>
          </div>

          {/* Wallet */}
          <div className="p-6 flex flex-col justify-center">
            <h2 className={`${typography.smallLabel} mb-3 flex items-center gap-2`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              Wallet
            </h2>
            <span className={typography.tokenAmount}>
              {publicKey ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}` : 'Not connected'}
            </span>
            <span className={`${typography.bodyText} text-gray-500 text-sm mt-1`}>
              {publicKey ? 'Solana Devnet' : 'Connect to place bets'}
            </span>
          </div>

          {/* Network */}
          <div className="p-6 flex flex-col justify-center">
            <h2 className={`${typography.smallLabel} mb-3 flex items-center gap-2`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              Network
            </h2>
            <span className={typography.tokenAmount}>Solana</span>
            <span className={`${typography.bodyText} text-gray-500 text-sm mt-1`}>Devnet</span>
          </div>

          {/* TEE Oracle */}
          <div className="p-6 flex flex-col justify-center">
            <h2 className={`${typography.smallLabel} mb-3 flex items-center gap-2`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              TEE Oracle
            </h2>
            <span className={typography.tokenAmount}>AWS Nitro</span>
            <span className={`${typography.bodyText} text-gray-500 text-sm mt-1`}>Attested inference</span>
          </div>
        </div>

        {/* Two Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Markets — real on-chain data */}
          <div className="bg-white rounded-xl shadow-[0_0.25rem_0.75rem_rgba(0,0,0,0.06)] border border-gray-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/40">
              <h2 className={typography.sectionHeader}>Markets</h2>
              <a href="/market" className="flex items-center gap-1 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-md text-sm font-medium transition-colors shadow-sm">
                View All
              </a>
            </div>
            <div className="flex flex-col flex-1 divide-y divide-gray-100">
              {!markets || markets.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">
                  {markets === undefined ? 'Loading markets...' : 'No markets on-chain yet.'}
                </div>
              ) : (
                markets.slice(0, 5).map((m: typeof markets[0], i: number) => {
                  const statusLabel = m.status === 0 ? 'NEW' : m.status === 1 ? 'PROPOSED' : m.status === 2 ? 'DISPUTED' : 'RESOLVED';
                  const statusClass = m.status === 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : m.status === 1 ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : m.status === 2 ? 'bg-orange-50 text-orange-700 border border-orange-200'
                    : 'bg-gray-50 text-gray-600 border border-gray-200';
                  return (
                    <div key={i} className="p-4 flex flex-col sm:flex-row items-center gap-4 hover:bg-gray-50/50 transition-colors">
                      <div className="hidden sm:flex w-12 h-12 bg-gray-100 rounded-lg items-center justify-center shrink-0">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                      </div>
                      <div className="flex-1 flex flex-col gap-1 text-center sm:text-left min-w-0 w-full sm:w-auto">
                        <span className={typography.walletHash}>{m.questionUri?.slice(0, 60) || 'Untitled market'}{m.questionUri && m.questionUri.length > 60 ? '...' : ''}</span>
                        <span className={`${typography.bodyText} text-gray-500 text-sm`}>
                          YES {(Number(m.yesPool) / 1e6).toFixed(1)} · NO {(Number(m.noPool) / 1e6).toFixed(1)}
                        </span>
                      </div>
                      <div className="flex items-center justify-center sm:justify-end shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                        <span className={`text-[0.7rem] font-semibold px-2 py-1 rounded-md inline-block shadow-sm ${statusClass}`}>{statusLabel}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="p-4 border-t border-gray-200 bg-gray-50/40 mt-auto">
              <a href="/market" className={`${typography.bodyText} w-full py-2 bg-gray-200 text-gray-800 hover:bg-gray-300 transition-colors uppercase font-medium rounded-md tracking-wide text-xs block text-center`}>
                View All Markets →
              </a>
            </div>
          </div>

          {/* How It Works */}
          <div className="bg-white rounded-xl shadow-[0_0.25rem_0.75rem_rgba(0,0,0,0.06)] border border-gray-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/40">
              <h2 className={typography.sectionHeader}>How It Works</h2>
            </div>
            <div className="p-6 flex flex-col gap-6">
              <div className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-emerald-700 font-bold text-sm">1</span>
                </div>
                <div>
                  <p className={`${typography.bodyText} font-medium text-[#212529]`}>Place a bet</p>
                  <p className={`${typography.bodyText} text-gray-500 text-sm`}>Choose YES or NO. Your tokens go into a shared pool.</p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-blue-700 font-bold text-sm">2</span>
                </div>
                <div>
                  <p className={`${typography.bodyText} font-medium text-[#212529]`}>AI agents investigate</p>
                  <p className={`${typography.bodyText} text-gray-500 text-sm`}>Autonomous agents research the question, powered by AWS Nitro TEE — a hardware enclave that keeps inference private and tamper-proof.</p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-purple-700 font-bold text-sm">3</span>
                </div>
                <div>
                  <p className={`${typography.bodyText} font-medium text-[#212529]`}>Agents vote with proof</p>
                  <p className={`${typography.bodyText} text-gray-500 text-sm`}>Each agent commits a vote hash, then reveals the answer with a TEE attestation — cryptographic proof the vote came from an enclave, not a human.</p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-amber-700 font-bold text-sm">4</span>
                </div>
                <div>
                  <p className={`${typography.bodyText} font-medium text-[#212529]`}>Winners split the pool</p>
                  <p className={`${typography.bodyText} text-gray-500 text-sm`}>Correct bettors share the opposing pool proportionally. Wrong bets lose their stake.</p>
                </div>
              </div>
              <div className="mt-2 p-3 bg-[#f0fdf4] border border-emerald-200 rounded-lg">
                <p className="text-emerald-700 text-xs font-medium">TEE Attestation</p>
                <p className="text-emerald-600 text-xs mt-1">AWS Nitro Enclaves produce cryptographic proofs (PCR0/PCR1) verified on Solana — no single operator can manipulate outcomes.</p>
              </div>
            </div>
          </div>

        </div>

      </main>

      <footer className="bg-gray-100 border-t border-gray-200 py-10 mt-10">
        <div className="w-[96%] max-w-[1800px] mx-auto text-center text-gray-500 text-sm">
          &copy; {new Date().getFullYear()} Smith Protocol — Decentralized AI Oracle Prediction Markets<br />
          Built on 0G Chain · Hedera HCS · World ID
        </div>
      </footer>
    </div>
  );
}
