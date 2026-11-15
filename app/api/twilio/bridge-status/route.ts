import { lineBySid, log } from "@/lib/state";
import { forbidden, readWebhook, twiml } from "@/lib/twilio";

/** Runs after the <Dial> to the SDR ends. */
export async function POST(req: Request) {
  const p = await readWebhook(req);
  if (!p) return forbidden();
  if (p.DialCallStatus !== "completed") {
    const line = lineBySid(p.CallSid);
    log(`SDR softphone didn't pick up (${p.DialCallStatus}) for ${line?.lead?.name ?? p.CallSid}`);
    return twiml(
      `<Say voice="Polly.Matthew">Sorry, looks like we got disconnected. We'll call you right back.</Say><Hangup/>`,
    );
  }
  return twiml("<Hangup/>");
}
