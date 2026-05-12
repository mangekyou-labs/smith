"use client";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

export function SolanaConnectWallet({
  appearance = "default",
}: {
  appearance?: "default" | "warm";
}) {
  const { publicKey } = useWallet();

  if (publicKey) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
            fontSize: 13,
            color: "#666",
          }}
        >
          {publicKey.toBase58().slice(0, 6)}...{publicKey.toBase58().slice(-4)}
        </span>
        <WalletMultiButton
          style={{
            background: "#f1f5f9",
            border: "1px solid #f0f0f0",
            borderRadius: 8,
            fontSize: 13,
            padding: "6px 14px",
            color: "inherit",
          }}
        />
      </div>
    );
  }

  return (
    <WalletMultiButton
      style={{
        background: "#10b981",
        border: "none",
        borderRadius: 6,
        fontSize: 14,
        padding: "8px 20px",
        fontWeight: 500,
      }}
    />
  );
}
