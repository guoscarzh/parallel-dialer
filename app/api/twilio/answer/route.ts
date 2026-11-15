import { amdEnabled, claimHuman, connectTwiml } from "@/lib/routing";
import { lineBySid, session } from "@/lib/state";
import { forbidden, readWebhook, twiml } from "@/lib/twilio";

/** Call answered. */
export async function POST(req: Request) {
  const p = await readWebhook(req);
  if (!p) return forbidden();
  const s = session();
  const line = lineBySid(p.CallSid);

  if (!amdEnabled()) {
    // No machine detection (trial accounts). On a trial, Twilio only reaches this point after the
    // callee pressed a key on its trial message, so whoever is here is a person.
    if (!line) return twiml("<Hangup/>");
    return (await claimHuman(line, p.CallSid)) ? twiml(connectTwiml()) : twiml("<Hangup/>");
  }

  // Someone else already won and this line wasn't torn down in time.
  if (s.winnerSid && s.winnerSid !== p.CallSid && line?.status !== "voicemail") {
    return twiml("<Hangup/>");
  }
  // Stay silent while async AMD decides (talking would confuse it).
  return twiml('<Pause length="45"/>');
}
