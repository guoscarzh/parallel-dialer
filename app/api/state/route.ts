import { connection } from "next/server";
import { ensureQueue } from "@/lib/leads";
import { session } from "@/lib/state";

export async function GET() {
  await connection(); // always dynamic
  await ensureQueue().catch(() => {}); // show the queue before the first dial (web mode: live list of phones)
  const s = session();
  return Response.json({
    lines: s.lines,
    winnerSid: s.winnerSid,
    queue: s.queue.slice(0, 8),
    queueRemaining: s.queue.length,
    queueLoaded: s.queueLoaded,
    leadSource: s.leadSource,
    stats: s.stats,
    sessionStartedAt: s.sessionStartedAt,
    batchStartedAt: s.batchStartedAt,
    history: s.history.slice(0, 20),
    briefs: Object.fromEntries(
      s.lines.filter((l) => l.lead && s.briefs[l.lead.id]).map((l) => [l.lead!.id, s.briefs[l.lead!.id]]),
    ),
    log: s.log.slice(0, 40),
    simulate: s.simulate,
    web: s.web,
    publicUrl: process.env.PUBLIC_URL ?? null,
    sdrName: process.env.SDR_NAME || "Your rep",
    serverNow: Date.now(),
  });
}
