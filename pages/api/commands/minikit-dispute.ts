/**
 * POST /api/commands/minikit-dispute
 *
 * Proxy route for DisputeResolution component.
 * Imports and calls solana-resolve handler directly to avoid API key auth
 * when forwarding internally.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import solanaResolveHandler from "@/pages/api/commands/solana-resolve";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { marketId, question } = req.body;
  if (!marketId || !question) {
    return res.status(400).json({ error: "marketId and question required" });
  }

  // Forge req.body to look like a solana-resolve request
  const innerReq = {
    ...req,
    body: {
      marketIdHex: marketId.startsWith("0x") ? marketId : `0x${marketId}`,
      question,
      committeeSize: 5,
      round: 1,
      skipOnChain: true,
    },
    headers: {
      ...req.headers,
      "x-api-key": process.env.INTERNAL_API_KEY ?? "",
    },
  } as NextApiRequest;

  const innerRes = {
    status: (code: number) => {
      // Capture status code
      innerRes.statusCode = code;
      return innerRes;
    },
    statusCode: 200,
    json: (data: unknown) => {
      // Reformat solana-resolve response to DisputeResolution expectations
      const tally = (data as Record<string, unknown>).tally as { YES: number; NO: number } ?? { YES: 0, NO: 0 };
      const reveals = ((data as Record<string, unknown>).votes as Array<{ agent: string; vote: "YES" | "NO"; reasoning: string }> ?? []).map((v) => ({
        agent: v.agent,
        vote: v.vote,
        reasoning: v.reasoning ?? "",
      }));

      return res.status(innerRes.statusCode).json({
        round1: { tally, reveals },
        resolved: !!(data as Record<string, unknown>).consensus,
        consensus: (data as Record<string, unknown>).consensus ?? null,
        round2: null,
      });
    },
  } as unknown as NextApiResponse;

  await solanaResolveHandler(innerReq, innerRes);
}
