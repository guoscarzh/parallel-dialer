import { claimHuman } from "@/lib/routing";
import { lineBySid, log, markEnded, session, setStatus } from "@/lib/state";
import { ACTIVE_STATUSES } from "@/lib/types";

type WebEvent = "ringing" | "answered" | "declined" | "no-answer" | "ended" | "failed";

/** Call progress for web phone calls, reported by the dashboard (media side) or the phone page. */
export async function POST(req: Request) {
  const { callSid, event, detail } = (await req.json().catch(() => ({}))) as {
    callSid?: string;
    event?: WebEvent;
    detail?: string;
  };
  if (!callSid?.startsWith("WEB-") || !event) return Response.json({ error: "bad event" }, { status: 400 });
  const line = lineBySid(callSid);
  if (!line) return Response.json({ ok: false, won: false });
  const n = `Line ${line.index + 1}`;
  const who = line.lead?.name ?? callSid;

  switch (event) {
    case "ringing":
      if (line.status === "dialing") setStatus(line, "ringing");
      break;
    case "answered": {
      if (!ACTIVE_STATUSES.includes(line.status)) return Response.json({ ok: true, won: false });
      const won = await claimHuman(line, callSid);
      if (won) {
        session().lines.filter((l) => l.status === "dropped").forEach(markEnded);
      } else {
        markEnded(line);
      }
      return Response.json({ ok: true, won });
    }
    case "declined":
      if (ACTIVE_STATUSES.includes(line.status) && line.status !== "connected") {
        setStatus(line, "voicemail");
        log(`${n}: ${who} sent it to voicemail → dropping message`);
        markEnded(line);
      }
      break;
    case "no-answer":
      if (line.status === "dialing" || line.status === "ringing") {
        setStatus(line, "no-answer");
        log(`${n}: no-answer`);
        markEnded(line);
      }
      break;
    case "ended":
      if (line.status === "connected") log(`${n}: call with ${who} ended`);
      if (ACTIVE_STATUSES.includes(line.status)) setStatus(line, "ended");
      markEnded(line);
      break;
    case "failed":
      if (ACTIVE_STATUSES.includes(line.status)) {
        setStatus(line, "failed");
        log(`${n}: couldn't reach ${who}'s web phone${detail ? ` (${detail})` : ""}`);
        markEnded(line);
      }
      break;
  }
  return Response.json({ ok: true });
}
