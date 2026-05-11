"use client";
import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlaceBet } from "@/lib/solana/useTransactions";
import { PublicKey } from "@solana/web3.js";

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
}: PlaceBetModalProps) {
  const { publicKey, connected } = useWallet();
  const placeBet = usePlaceBet();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setAmount("");
      setError(null);
      setSig(null);
      setLoading(false);
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
      const mint = new PublicKey(mintAddress);
      const bettorTokenAccount = await getAssociatedTokenAddress(mint, publicKey);

      const signature = await placeBet.mutateAsync({
        marketIdHex,
        outcome,
        amount: parsed,
        bettorTokenAccount,
        mint,
      });

      setSig(signature);
    } catch (e: unknown) {
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
        </div>

        {/* Error */}
        {error && (
          <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Success */}
        {sig && (
          <div style={{ color: "#86efac", fontSize: 13, marginBottom: 12, wordBreak: "break-all" }}>
            Done! Tx: {sig.slice(0, 12)}...
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
              background: loading ? "#555" : "#10b981",
              color: "#111",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: connected ? 1 : 0.5,
            }}
          >
            {loading ? "Signing..." : connected ? "Confirm Bet" : "Connect Wallet"}
          </button>
        </div>
      </div>
    </div>
  );
}