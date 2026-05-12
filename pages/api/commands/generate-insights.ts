/**
 * POST /api/commands/generate-insights
 *
 * Returns word cloud and reference data for the dispute flow.
 * Currently a stub — real implementation would call OpenAI.
 */
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  // Return empty stubs so fetchInsights() in dispute.tsx never throws
  return res.json({
    success: true,
    wordCloud: [],
    references: [],
  });
}
