import { clearSim } from "@/lib/sim";
import { log, markEnded, session, setStatus } from "@/lib/state";
import { endCall } from "@/lib/twilio";
import { ACTIVE_STATUSES } from "@/lib/types";

/** End every active line (stop batch, or hang up a simulated call). */
export async function POST() {
  const s = session();
  const active = s.lines.filter((l) => l.callSid && ACTIVE_STATUSES.includes(l.status));
  if (s.simulate) clearSim();
  await Promise.all(active.map((l) => endCall(l.callSid!)));
  for (const l of active) {
    if (l.status === "connected") log(`Line ${l.index + 1}: call with ${l.lead?.name} ended`);
    setStatus(l, "ended");
    markEnded(l);
  }
  // A simulated voicemail still "playing" is finished too.
  if (s.simulate) s.lines.filter((l) => l.status === "voicemail").forEach(markEnded);
  if (!active.some((l) => l.status === "ended" && l.connectedAt)) log(`Stopped batch (${active.length} calls ended)`);
  return Response.json({ ok: true });
}
