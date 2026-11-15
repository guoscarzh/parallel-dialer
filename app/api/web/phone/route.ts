import { connection } from "next/server";
import { session } from "@/lib/state";

/** The phone page polls this to learn what happened to its call (won, released, ended). */
export async function GET(req: Request) {
  await connection();
  const peerId = new URL(req.url).searchParams.get("peerId");
  const s = session();
  const line = s.lines.find((l) => l.lead?.id === `web-${peerId}`);
  return Response.json({
    status: line?.status ?? null,
    callSid: line?.callSid ?? null,
    sdrName: process.env.SDR_NAME || "Your rep",
  });
}
