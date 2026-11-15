import { ensureQueue } from "@/lib/leads";
import { clearSim } from "@/lib/sim";
import { log, resetLines, session } from "@/lib/state";
import { ACTIVE_STATUSES } from "@/lib/types";

/** Switch between live Twilio calls and simulated calls. Reloads the matching lead list. */
export async function POST(req: Request) {
  const { simulate, mode } = (await req.json().catch(() => ({}))) as { simulate?: boolean; mode?: "live" | "sim" | "web" };
  const target = mode ?? (simulate ? "sim" : "live");
  const s = session();
  if (s.lines.some((l) => ACTIVE_STATUSES.includes(l.status))) {
    return Response.json({ error: "End the current batch first" }, { status: 409 });
  }
  clearSim();
  s.simulate = target === "sim";
  s.web = target === "web";
  resetLines();
  s.queueLoaded = false;
  await ensureQueue().catch(() => {});
  log(
    s.web ? "Switched to web phones (WebRTC calls to phones that opened the link)" : s.simulate ? "Switched to simulated calls (demo leads)" : "Switched to live calls",
  );
  return Response.json({ ok: true, mode: target });
}
