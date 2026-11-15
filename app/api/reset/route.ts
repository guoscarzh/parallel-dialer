import { ensureQueue } from "@/lib/leads";
import { clearSim } from "@/lib/sim";
import { freshStats, log, resetLines, session } from "@/lib/state";
import { ACTIVE_STATUSES } from "@/lib/types";

/** Reload leads from the source and start a fresh session (for demos). */
export async function POST() {
  const s = session();
  if (s.lines.some((l) => ACTIVE_STATUSES.includes(l.status))) {
    return Response.json({ error: "End the current batch first" }, { status: 409 });
  }
  clearSim();
  resetLines();
  s.queueLoaded = false;
  s.stats = freshStats();
  s.batchStartedAt = null;
  s.sessionStartedAt = null;
  s.history = [];
  s.log = [];
  try {
    await ensureQueue();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  log("Session reset");
  return Response.json({ ok: true });
}
