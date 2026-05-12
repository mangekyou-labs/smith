"use client";
import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMarketAccounts } from "@/lib/solana/market-index";

const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";

const PROGRAM_ID =
  process.env.NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID ??
  "CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx";

export function useMarkets() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: async () => {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const markets = await getMarketAccounts(connection);
      return markets;
    },
    refetchInterval: 30_000,
  });
}

export function useMarket(marketIdHex: string) {
  return useQuery({
    queryKey: ["market", marketIdHex],
    queryFn: async () => {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const markets = await getMarketAccounts(connection);
      return markets.find(
        (m) => m.marketId.toLowerCase() === marketIdHex.toLowerCase()
      ) ?? null;
    },
    enabled: !!marketIdHex,
  });
}

export { PROGRAM_ID, SOLANA_RPC_URL };
