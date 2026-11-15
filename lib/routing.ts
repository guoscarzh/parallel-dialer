import { log, session, setStatus } from "./state";
import { endCall, publicUrl, SDR_IDENTITY } from "./twilio";
import { ACTIVE_STATUSES, type Line } from "./types";

/** TwiML body that greets the lead and bridges them to the SDR's browser softphone. */
export function connectTwiml() {
  return (
    `<Say voice="Polly.Matthew">Hi, one sec, connecting you now.</Say>` +
    `<Dial action="${publicUrl("/api/twilio/bridge-status")}" timeout="15"><Client>${SDR_IDENTITY}</Client></Dial>`
  );
}

/**
 * A human answered on this line. The first one wins the SDR: other active lines are hung up.
 * Returns false if another line already won (caller should hang this one up).
 */
export async function claimHuman(line: Line, callSid: string): Promise<boolean> {
  const s = session();
  const who = line.lead?.name ?? callSid;
  if (s.winnerSid && s.winnerSid !== callSid) {
    setStatus(line, "dropped");
    log(`Line ${line.index + 1}: ${who} answered but SDR is busy, hanging up`);
    return false;
  }
  s.winnerSid = callSid;
  setStatus(line, "connected");
  log(`Line ${line.index + 1}: ${who} is human → connecting to SDR`);
  const others = s.lines.filter((l) => l.callSid && l.callSid !== callSid && ACTIVE_STATUSES.includes(l.status));
  others.forEach((l) => setStatus(l, "dropped"));
  void Promise.all(others.map((l) => endCall(l.callSid!)));
  return true;
}

/** Full (upgraded) Twilio features: AMD + ring timeout. Trial accounts reject both, so TWILIO_AMD=false. */
export const amdEnabled = () => process.env.TWILIO_AMD !== "false";
