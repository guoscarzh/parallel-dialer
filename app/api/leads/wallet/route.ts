import { connection } from "next/server";
import { getWallet } from "@/lib/leads/scrapercity";

/** Free balance check so the UI can show remaining trial credit. */
export async function GET() {
  await connection();
  if (!process.env.SCRAPERCITY_API_KEY) return Response.json({ configured: false });
  try {
    const w = await getWallet();
    return Response.json({
      configured: true,
      spendAllowed: process.env.SCRAPERCITY_ALLOW_SPEND === "true",
      balanceDollars: (w.balanceMicro / 1e6).toFixed(2),
      usedDollars: (w.usedMicro / 1e6).toFixed(2),
      capDollars: Number(process.env.SCRAPERCITY_MAX_SPEND_DOLLARS ?? "1").toFixed(2),
    });
  } catch (e) {
    return Response.json({ configured: true, error: (e as Error).message });
  }
}
