import { lineBySid, log, markEnded, setStatus } from "@/lib/state";
import { forbidden, readWebhook } from "@/lib/twilio";
import type { LineStatus } from "@/lib/types";

const FINAL: LineStatus[] = ["voicemail", "dropped", "ended", "failed", "busy", "no-answer"];

/** Call progress events → line status. */
export async function POST(req: Request) {
  const p = await readWebhook(req);
  if (!p) return forbidden();
  const line = lineBySid(p.CallSid);
  if (!line) return new Response(null, { status: 204 });
  const n = line.index + 1;

  if (["completed", "busy", "no-answer", "failed", "canceled"].includes(p.CallStatus)) markEnded(line);

  switch (p.CallStatus) {
    case "initiated":
      if (line.status === "idle") setStatus(line, "dialing");
      break;
    case "ringing":
      if (line.status === "dialing") setStatus(line, "ringing");
      break;
    case "in-progress":
      if (line.status === "dialing" || line.status === "ringing") setStatus(line, "detecting");
      break;
    case "completed":
      if (line.status === "connected") log(`Line ${n}: call with ${line.lead?.name} ended`);
      if (!FINAL.includes(line.status)) setStatus(line, "ended");
      break;
    case "busy":
    case "no-answer":
    case "failed":
      if (line.status !== "dropped") setStatus(line, p.CallStatus as LineStatus);
      log(`Line ${n}: ${p.CallStatus}`);
      break;
    case "canceled":
      if (!FINAL.includes(line.status)) setStatus(line, "dropped");
      break;
  }
  return new Response(null, { status: 204 });
}
