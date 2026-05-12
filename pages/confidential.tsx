"use client";
import { useState, useEffect } from "react";
import { SolanaConnectWallet } from "../components/solana/SolanaConnectWallet";

// FHE types from encrypt-grpc.ts
const FHE_BOOL = 0;
const FHE_UINT64 = 4;

function MockEncryptValue({ value, fheType }: { value: string; fheType: number }) {
  const bytes = new Uint8Array(17);
  bytes[0] = fheType;
  const num = BigInt(value);
  for (let i = 0; i < 16; i++) {
    bytes[i + 1] = Number((num >> BigInt(i * 8)) & BigInt(0xff));
  }
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return (
    <code className="font-mono text-xs bg-slate-100 px-2 py-1 rounded break-all">{hex}</code>
  );
}

function StepCard({
  num,
  title,
  description,
  detail,
}: {
  num: number;
  title: string;
  description: string;
  detail?: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 p-5 bg-white border border-slate-200 rounded-xl">
      <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
        {num}
      </div>
      <div>
        <h3 className="font-semibold text-slate-800">{title}</h3>
        <p className="text-sm text-slate-600 mt-1">{description}</p>
        {detail && <div className="mt-3">{detail}</div>}
      </div>
    </div>
  );
}

export default function ConfidentialPage() {
  const [betAmount] = useState("100");
  const [vote, setVote] = useState<"YES" | "NO">("YES");
  const [step, setStep] = useState(0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="w-full flex justify-center relative pt-4 z-[100] px-2 md:px-0 bg-transparent">
        <div className="w-[96%] max-w-[1800px] h-[60px] grid grid-cols-3 items-center pl-4 pr-2 lg:pl-8 lg:pr-3 rounded-full border border-black/80 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3),0_8px_32px_0_rgba(31,38,135,0.1),inset_0_2px_3px_rgba(255,255,255,0.9),inset_0_-1px_3px_rgba(0,0,0,0.05)] backdrop-blur-[24px] bg-white/60"
          style={{
            backgroundImage: "linear-gradient(110deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.1) 40%, rgba(255,255,255,0) 40%, rgba(255,255,255,0.3) 70%, rgba(255,255,255,0) 70%), linear-gradient(35deg, rgba(255,255,255,0) 20%, rgba(255,255,255,0.4) 20%, rgba(255,255,255,0.1) 60%, rgba(255,255,255,0) 60%), linear-gradient(to bottom, rgba(255,255,255,0.4), rgba(255,255,255,0.1))",
          }}>
          <nav className="flex items-center gap-2 justify-start pl-2">
            <a href="/" className="font-[500] text-[17px] text-slate-700 hover:bg-slate-200/80 px-4 py-2 rounded-xl transition-all tracking-wide">Home</a>
            <a href="/market" className="font-[500] text-[17px] text-slate-700 hover:bg-slate-200/80 px-4 py-2 rounded-xl transition-all tracking-wide">Market</a>
          </nav>
          <div className="flex items-center justify-center">
            <span className="font-[700] text-[22px] tracking-[0.15em] text-slate-800">SMITH</span>
          </div>
          <div className="flex items-center justify-end">
            <SolanaConnectWallet appearance="warm" />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        {/* Sponsor Badge */}
        <div className="text-center mb-8">
          <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide mb-3">
            Powered by Encrypt — dWallet Labs
          </span>
          <h1 className="text-3xl font-bold text-slate-800">Confidential Betting</h1>
          <p className="text-slate-600 mt-3 max-w-xl mx-auto">
            Your bets are encrypted on-chain using Fully Homomorphic Encryption (FHE). Nobody — not even the oracle — can see your position until the market resolves.
          </p>
        </div>

        {/* Pre-alpha Notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
          <p className="text-sm text-amber-800">
            <strong>Pre-alpha:</strong> Encryption is currently mocked. All data is stored publicly on-chain as plaintext. Real FHE (REFHE) is planned for production.
          </p>
        </div>

        {/* How It Works */}
        <div className="space-y-4 mb-10">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">How FHE Confidential Betting Works</h2>

          <StepCard
            num={1}
            title="Encrypt your bet"
            description="Your bet amount and vote (YES/NO) are encrypted locally before being submitted on-chain. The ciphertext is unreadable by anyone."
            detail={
              <div className="bg-slate-50 rounded-lg p-3 text-xs">
                <div className="font-semibold text-slate-700 mb-2">Encrypted payload (mock, pre-alpha):</div>
                <div className="space-y-1">
                  <div>
                    <span className="text-slate-500">fhe_type: </span>
                    <span className="font-mono">{vote === "YES" ? "EBool (0)" : "EBool (0)"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">encrypted_value: </span>
                    <MockEncryptValue value={vote === "YES" ? "1" : "0"} fheType={FHE_BOOL} />
                  </div>
                  <div>
                    <span className="text-slate-500">bet_amount (EUint64): </span>
                    <MockEncryptValue value={betAmount} fheType={FHE_UINT64} />
                  </div>
                </div>
              </div>
            }
          />

          <StepCard
            num={2}
            title="Submit encrypted position on-chain"
            description="The encrypted bet is recorded in the confidential-market program. The contract can perform computations on the encrypted data without ever decrypting it."
            detail={
              <div className="bg-slate-50 rounded-lg p-3 text-xs">
                <div className="font-semibold text-slate-700 mb-2">On-chain accounts touched:</div>
                <div className="space-y-1 font-mono text-slate-600">
                  <div>→ confidential_market::Market</div>
                  <div>→ encrypt::Ciphertext (bet amount)</div>
                  <div>→ encrypt::Ciphertext (vote)</div>
                  <div>→ vault (escrow)</div>
                </div>
              </div>
            }
          />

          <StepCard
            num={3}
            title="Oracle computes on encrypted data"
            description="The AI oracle runs its inference inside a TEE enclave and produces an encrypted vote. The encrypted votes are aggregated — YES and NO pools are tallied without revealing individual positions."
            detail={
              <div className="bg-slate-50 rounded-lg p-3 text-xs">
                <div className="font-semibold text-slate-700 mb-2">FHE graph executed on-chain:</div>
                <div className="space-y-1">
                  <div className="font-mono">cast_vote_graph(yes_count, no_count, vote)</div>
                  <div className="text-slate-500">→ conditionally increments yes_pool or no_pool</div>
                  <div className="text-slate-400 mt-2">Computation happens entirely on encrypted data. The result is also encrypted.</div>
                </div>
              </div>
            }
          />

          <StepCard
            num={4}
            title="Market resolves — decryption requested"
            description="After the market resolves, a decryption request is sent. The encrypted payout is revealed only to the contract — your individual position stays private until settlement."
            detail={
              <div className="bg-slate-50 rounded-lg p-3 text-xs">
                <div className="font-semibold text-slate-700 mb-2">FHE payout graph:</div>
                <div className="space-y-1">
                  <div className="font-mono">compute_payout_graph_yes(bet, yes_pool, no_pool)</div>
                  <div className="font-mono">compute_payout_graph_no(bet, yes_pool, no_pool)</div>
                  <div className="text-slate-500">→ encrypted result verified by contract → settlement</div>
                </div>
              </div>
            }
          />
        </div>

        {/* Interactive Demo */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Live Demo (Devnet)</h2>
          <p className="text-sm text-slate-600 mb-4">
            Connect your wallet to simulate the FHE betting flow locally. This uses the mock client — no real encryption.
          </p>

          <div className="text-center py-8 bg-slate-50 rounded-xl">
            <p className="text-slate-500 mb-4">Connect your wallet to try the demo</p>
            <SolanaConnectWallet appearance="warm" />
          </div>

          {/* Demo UI — always visible */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Bet Amount (USDC)</label>
                <input
                  type="number"
                  value={betAmount}
                  readOnly
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Vote</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setVote("YES")}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${vote === "YES" ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    YES
                  </button>
                  <button
                    onClick={() => setVote("NO")}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${vote === "NO" ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    NO
                  </button>
                </div>
              </div>
            </div>

            {/* Simulate flow */}
            <div className="bg-slate-50 rounded-xl p-4 text-xs font-mono space-y-2">
              <div className="font-semibold text-slate-700 mb-3">Simulation log:</div>
              {step >= 0 && (
                <div className="text-slate-500">
                  → encryptValue({betAmount}, EUint64) → <MockEncryptValue value={betAmount} fheType={FHE_UINT64} />
                </div>
              )}
              {step >= 1 && (
                <div className="text-slate-500">
                  → encryptValue({vote}, EBool) → <MockEncryptValue value={vote === "YES" ? "1" : "0"} fheType={FHE_BOOL} />
                </div>
              )}
              {step >= 2 && (
                <div className="text-indigo-600">
                  → submitPlaceBetCpi(encrypted_cts...) — tx submitted
                </div>
              )}
              {step >= 3 && (
                <div className="text-amber-600">
                  → compute_payout_graph running on encrypted state...
                </div>
              )}
              {step >= 4 && (
                <div className="text-emerald-600">
                  ✓ Market resolved. Decryption requested. Payout computed on encrypted data.
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep((s) => Math.min(s + 1, 4))}
                disabled={step >= 4}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40"
              >
                {step === 0 ? "Encrypt Bet" : step === 1 ? "Encrypt Vote" : step === 2 ? "Submit On-Chain" : step === 3 ? "Run FHE Computation" : "Done"}
              </button>
              <button
                onClick={() => setStep(0)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Technical Details */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Technical Details</h2>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="font-semibold text-slate-700 mb-2">Encrypt Program</div>
              <div className="font-mono text-slate-600 break-all">Cq37zHSH1zB6xomYK2LjP6uXJvLR3uTehxA5W9wgHGvx</div>
            </div>
            <div>
              <div className="font-semibold text-slate-700 mb-2">Confidential Market</div>
              <div className="font-mono text-slate-600 break-all">BB17yKcbp9qNyokaNPo29gjFK9aYBEH69wpQgiRPZhwz</div>
            </div>
            <div>
              <div className="font-semibold text-slate-700 mb-2">gRPC Endpoint</div>
              <div className="font-mono text-slate-600">pre-alpha-dev-1.encrypt.ika-network.net:443</div>
            </div>
            <div>
              <div className="font-semibold text-slate-700 mb-2">SDK</div>
              <div className="font-mono text-slate-600">@encrypt.xyz/pre-alpha-solana-client</div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="text-xs text-slate-500">
              FHE graphs: <span className="font-mono">cast_vote_graph</span>, <span className="font-mono">compute_payout_graph_yes</span>, <span className="font-mono">compute_payout_graph_no</span>. CPI via <span className="font-mono">encrypt-anchor</span> SDK.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-12 text-xs text-slate-400">
          © 2026 Smith Protocol — Built on Solana Devnet · FHE by dWallet Labs
        </div>
      </main>
    </div>
  );
}
