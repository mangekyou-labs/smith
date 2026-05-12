import type { NextApiRequest, NextApiResponse } from "next";
import { getSolanaAgents, getMintedAgents } from "@/lib/0g-compute";

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Try Solana agents first (on-chain registered agents)
    let agents = await getSolanaAgents();

    // If no Solana agents yet, fall back to 0G iNFT registry
    // This lets the UI show live agent data even before any agent registers on Solana
    if (agents.length === 0) {
      agents = await getMintedAgents();
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json(agents);
  } catch (err) {
    // Last resort: try 0G agents only
    try {
      const agents = await getMintedAgents();
      res.setHeader("Cache-Control", "no-store");
      return res.json(agents);
    } catch {
      return res.status(500).json({ error: "Failed to fetch agents" });
    }
  }
}