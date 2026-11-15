import { log, session } from "@/lib/state";
import type { Disposition } from "@/lib/types";

const VALID: Disposition[] = ["meeting", "interested", "callback", "not-interested", "wrong-number"];

/** SDR logs the outcome of the connected call. */
export async function POST(req: Request) {
  const { callSid, disposition, notes } = (await req.json()) as {
    callSid?: string;
    disposition?: Disposition;
    notes?: string;
  };
  if (!disposition || !VALID.includes(disposition)) {
    return Response.json({ error: "Invalid disposition" }, { status: 400 });
  }
  const s = session();
  const line = s.lines.find((l) => l.callSid === callSid) ?? s.lines.find((l) => l.callSid === s.winnerSid);
  if (!line?.lead) return Response.json({ error: "No connected lead to disposition" }, { status: 400 });

  const existing = s.history.find((h) => h.lead.id === line.lead!.id);
  if (existing) {
    if (existing.disposition === "meeting") s.stats.meetings--;
    existing.disposition = disposition;
    existing.notes = notes ?? "";
  } else {
    s.history.unshift({ at: Date.now(), lead: line.lead, disposition, notes: notes ?? "" });
  }
  if (disposition === "meeting") s.stats.meetings++;
  log(`${line.lead.name}: dispositioned as ${disposition}`);
  return Response.json({ ok: true });
}
