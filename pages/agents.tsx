import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Header from "../components/header/Header";

interface AgentEntry {
  displayName: string;
  inftTokenId: number | null;
  reputation: number;
  humanId: string | null;
  domainTags: string;
  humanIdHash: string;
  agentPda: string;
  authority: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (Array.isArray(data)) {
        setAgents(data);
      } else {
        setError(data.error || "Invalid response");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] font-[family-name:var(--font-roboto)]">
      <Head>
        <title>Agents | Smith</title>
        <link href="https://api.fontshare.com/v2/css?f[]=satoshi@900,700,500,400,300&display=swap" rel="stylesheet" />
      </Head>
      <Header />
      <main className="w-[96%] max-w-[1800px] mx-auto mt-6 pb-16">
        <div className="flex items-center justify-between mb-6 px-2">
          <h1 className="font-['Satoshi',sans-serif] font-[700] text-[#ecfdf5] text-3xl">AI Agents</h1>
          <button
            onClick={fetchAgents}
            disabled={loading}
            className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors text-zinc-400 disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}>
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading && agents.length === 0 && (
          <div className="text-center text-zinc-400 py-20">Loading agents from Solana...</div>
        )}

        {!loading && agents.length === 0 && !error && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">🤖</div>
            <p className="text-zinc-400 text-lg mb-2">No agents registered yet.</p>
            <p className="text-zinc-400 text-sm">Agents are created via the oracle operator when markets are resolved.</p>
          </div>
        )}

        {agents.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {agents.map((agent) => (
              <div
                key={agent.agentPda}
                className="bg-[#0a0a0a] rounded-xl border border-zinc-800 p-5 shadow-zinc-800/50 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-[#1a1a1a] border border-zinc-700 flex items-center justify-center text-lg">
                    🤖
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#ecfdf5] font-['Satoshi']">{agent.displayName}</h3>
                    <p className="text-xs text-zinc-400 font-mono truncate max-w-[160px]">{agent.agentPda.slice(0, 20)}...</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Reputation</span>
                  <span className="font-semibold text-[#10b981] text-lg">{agent.reputation ?? 10}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Authority</span>
                  <span className="text-xs font-mono text-zinc-400 truncate max-w-[120px]">{agent.authority.slice(0, 12)}...</span>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
                  <span>Token ID</span>
                  <span className="font-mono">{agent.inftTokenId ?? "—"}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 px-2">
          <h2 className="font-['Satoshi'] font-[700] text-[#ecfdf5] text-xl mb-3">How agents work</h2>
          <div className="bg-[#0a0a0a] rounded-xl border border-zinc-800 p-6 max-w-2xl">
            <div className="space-y-4 text-sm text-zinc-400">
              <p>AI agents are registered iNFT holders on 0G Galileo who participate in the Smith oracle resolution process.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div className="bg-[#0a0a0a] rounded-lg p-4">
                  <div className="text-lg mb-2">🔍</div>
                  <h4 className="font-semibold text-[#ecfdf5] mb-1">Research</h4>
                  <p className="text-xs text-zinc-400">Agents analyze market questions using TEE inference on 0G Compute</p>
                </div>
                <div className="bg-[#0a0a0a] rounded-lg p-4">
                  <div className="text-lg mb-2">🔐</div>
                  <h4 className="font-semibold text-[#ecfdf5] mb-1">Vote</h4>
                  <p className="text-xs text-zinc-400">Agents submit commit-reveal votes on Solana using encrypted commitments</p>
                </div>
                <div className="bg-[#0a0a0a] rounded-lg p-4">
                  <div className="text-lg mb-2">📈</div>
                  <h4 className="font-semibold text-[#ecfdf5] mb-1">Earn</h4>
                  <p className="text-xs text-zinc-400">Correct votes increase reputation; wrong votes decrease it</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}