"use client";
import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { getBetEscrowPda } from "@/lib/solana/tx-builders";
import { SOLANA_RPC_URL } from "./useMarkets";

const PROGRAM_ID =
  process.env.NEXT_PUBLIC_SMITH_ORACLE_PROGRAM_ID ??
  "CX8CseQebFhKUyKH1SnddtXxCaxZBesHMdDYr1UPEdZx";

interface BetEscrowData {
  market: string;
  bettor: string;
  outcome: number;
  amount: string;
  claimed: boolean;
  bump: number;
}

async function getBetEscrow(
  connection: Connection,
  marketIdHex: string,
  bettor: PublicKey
): Promise<BetEscrowData | null> {
  const betEscrowPda = getBetEscrowPda(marketIdHex, bettor);
  const account = await connection.getAccountInfo(betEscrowPda);
  if (!account) return null;

  // Decode BetEscrow — skip 8-byte discriminator
  const data = account.data.slice(8);
  const bump = data[data.length - 1];

  return {
    market: marketIdHex,
    bettor: bettor.toBase58(),
    outcome: data[64], // outcome is at offset in account
    amount: data.slice(65, 73).reduce((acc, b, i) => acc + BigInt(b) * BigInt(2 ** (8 * i)), BigInt(0)).toString(),
    claimed: data[73] === 1,
    bump,
  };
}

export function useUserBet(marketIdHex: string, userPublicKey: PublicKey | null) {
  return useQuery({
    queryKey: ["bet", marketIdHex, userPublicKey?.toBase58()],
    queryFn: async () => {
      if (!userPublicKey) return null;
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const marketPda = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), Buffer.from(marketIdHex.slice(2), "hex")],
        new PublicKey(PROGRAM_ID)
      )[0];
      return getBetEscrow(connection, marketIdHex, userPublicKey);
    },
    enabled: !!marketIdHex && !!userPublicKey,
  });
}
