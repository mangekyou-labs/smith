"use client";
import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlaceBet, type BetTxState } from "@/lib/solana/useTransactions";
import { PublicKey } from "@solana/web3.js";

// FHE type constants (from encrypt-grpc.ts)
const FHE_BOOL = 0;
const FHE_UINT64 = 4;

function encryptValue(value: number, fheType: number): Uint8Array {
  const bytes = new Uint8Array(17);
  bytes[0] = fheType;
  const num = BigInt(value);
  for (let i = 0; i < 16; i++) {
    bytes[i + 1] = Number((num >> BigInt(i * 8)) & BigInt(0xff));
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS");

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

interface PlaceBetModalProps {
  open: boolean;
  onClose: () => void;
  marketIdHex: string;
  outcome: 1 | 2; // 1=YES, 2=NO
  mintAddress?: string;
  marketQuestion?: string;
  confidentialMode?: boolean;
}

// Devnet placeholder mint — no real value. Replace with real devnet USDC mint for mainnet betting.
const DEFAULT_MINT = process.env.NEXT_PUBLIC_DEVNET_USDC_MINT ?? "4zJfDU3X67bVxKqK6c6S6rX2bT8qJf9Yd6qZkLPj8Xz";

export function PlaceBetModal({
  open,
  onClose,
  marketIdHex,
  outcome,
  mintAddress = DEFAULT_MINT,
  marketQuestion = "This market",
  confidentialMode = false,
}: PlaceBetModalProps) {
  const { publicKey, connected } = useWallet();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [txState, setTxState] = useState<BetTxState>("idle");
  const [showEncryptPreview, setShowEncryptPreview] = useState(false);
  const placeBet = usePlaceBet((sig) => {
    setSig(sig);
    setTxState("pending");
  });

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setAmount("");
      setError(null);
      setSig(null);
      setLoading(false);
      setTxState("idle");
      setShowEncryptPreview(false);
    }
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!publicKey) {
      setError("Connect wallet first");
      return;
    }
    const parsed = parseInt(amount, 10);
    if (isNaN(parsed) || parsed <= 0) {
      setError("Enter a valid amount");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (confidentialMode) {
        // Confidential path: call API route which encrypts + submits via confidential-market program
        const res = await fetch("/api/commands/confidential-market", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "place_bet",
            marketIdHex,
            outcome,
            amount: parsed,
            mintAddress,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Confidential bet failed");
        setSig(data.signature);
        setTxState("confirmed");
      } else {
        // Regular path: wallet-adapter submits directly to smith_oracle program
        const mint = new PublicKey(mintAddress);
        const bettorTokenAccount = await getAssociatedTokenAddress(mint, publicKey);

        const result = await placeBet.mutateAsync({
          marketIdHex,
          outcome,
          amount: parsed,
          bettorTokenAccount,
          mint,
        });

        setSig(result.signature);
        setTxState(result.state);
        if (result.error) setError(result.error);
      }
    } catch (e: unknown) {
      setTxState("error");
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#18181b",
          border: "1px solid #10b981",
          borderRadius: 16,
          padding: 32,
          width: 400,
          maxWidth: "90vw",
          fontFamily: "Satoshi, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ color: "#10b981", fontSize: 20, fontWeight: 700, margin: 0 }}>
              Place Bet
            </h2>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer" }}
            >
              ×
            </button>
          </div>
          <p style={{ color: "#aaa", fontSize: 13, margin: "8px 0 0" }}>
            {marketQuestion}
          </p>
          <div
            style={{
              marginTop: 8,
              padding: "6px 12px",
              borderRadius: 6,
              background: outcome === 1 ? "#166534" : "#991b1b",
              color: outcome === 1 ? "#86efac" : "#fca5a5",
              fontSize: 14,
              fontWeight: 600,
              display: "inline-block",
            }}
          >
            {outcome === 1 ? "YES" : "NO"}
          </div>
        </div>

        {/* Confidential mode toggle */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              style={{
                flex: 1,
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid #333",
                background: !confidentialMode ? "#10b981" : "transparent",
                color: !confidentialMode ? "#111" : "#888",
                fontSize: 12,
                fontWeight: 600,
                cursor: "default",
              }}
            >
              Regular
            </button>
            <button
              style={{
                flex: 1,
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid #6366f1",
                background: confidentialMode ? "#6366f1" : "transparent",
                color: confidentialMode ? "#fff" : "#6366f1",
                fontSize: 12,
                fontWeight: 600,
                cursor: "default",
              }}
            >
              Confidential ✦
            </button>
          </div>
          {confidentialMode && (
            <p style={{ color: "#fbbf24", fontSize: 11, margin: 0 }}>
              Pre-alpha: encryption mocked — data stored publicly on-chain
            </p>
          )}
        </div>

        {/* Amount input */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ color: "#ccc", fontSize: 13, display: "block", marginBottom: 6 }}>
            Amount (tokens)
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            min="1"
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "#111",
              color: "#fff",
              fontSize: 16,
              outline: "none",
            }}
          />
          <p style={{ color: "#555", fontSize: 11, marginTop: 6 }}>Estimated fee: ~0.0005 SOL</p>
        </div>

        {/* Mock encryption preview */}
        {confidentialMode && amount && !isNaN(parseInt(amount, 10)) && parseInt(amount, 10) > 0 && (
          <div style={{ marginBottom: 16, padding: "10px 12px", background: "#0f0f23", borderRadius: 8, border: "1px solid #6366f1" }}>
            <p style={{ color: "#818cf8", fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Encryption Preview (mock)</p>
            <div style={{ fontSize: 10, fontFamily: "monospace", color: "#a5b4fc" }}>
              <div>amount: EUint64 = <span style={{ color: "#86efac" }}>{bytesToHex(encryptValue(parseInt(amount, 10), FHE_UINT64))}</span></div>
              <div>vote: EBool = <span style={{ color: "#86efac" }}>{bytesToHex(encryptValue(outcome === 1 ? 1 : 0, FHE_BOOL))}</span></div>
              <div style={{ color: "#64748b", marginTop: 4 }}>→ sent to confidential-market program</div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Transaction state feedback */}
        {sig && (
          <div style={{ marginBottom: 12 }}>
            {txState === "pending" && (
              <div style={{ color: "#facc15", fontSize: 13 }}>
                Submitted... waiting for confirmation
              </div>
            )}
            {txState === "confirmed" && (
              <div style={{ color: "#86efac", fontSize: 13 }}>
                Confirmed!{" "}
                <a
                  href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#6ee7b7", textDecoration: "underline" }}
                >
                  View on Explorer
                </a>
              </div>
            )}
            {txState === "error" && (
              <div style={{ color: "#f87171", fontSize: 13 }}>
                Failed: {error}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "transparent",
              color: "#888",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !connected}
            style={{
              flex: 1,
              padding: "10px 16px",
              borderRadius: 8,
              border: "none",
              background: loading ? "#555" : confidentialMode ? "#6366f1" : "#10b981",
              color: "#111",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: connected ? 1 : 0.5,
            }}
          >
            {loading ? "Signing..." : connected ? (confidentialMode ? "Encrypt Bet" : "Confirm Bet") : "Connect Wallet"}
          </button>
        </div>
      </div>
    </div>
  );
}