import { lineBySid, log, setStatus } from "@/lib/state";
import { claimHuman, connectTwiml } from "@/lib/routing";
import { client, endCall, forbidden, readWebhook, voicemailTwiml } from "@/lib/twilio";

const wrap = (xml: string) => `<Response>${xml}</Response>`;

/** Async AMD result: route humans to the SDR, drop voicemail on machines. */
export async function POST(req: Request) {
  const p = await readWebhook(req);
  if (!p) return forbidden();
  const sid = p.CallSid;
  const answeredBy = p.AnsweredBy ?? "unknown";
  const line = lineBySid(sid);
  if (!line) return new Response(null, { status: 204 });
  line.answeredBy = answeredBy;
  const who = line.lead?.name ?? sid;

  try {
    if (answeredBy === "human" || answeredBy === "unknown") {
      if (await claimHuman(line, sid)) {
        await client().calls(sid).update({ twiml: wrap(connectTwiml()) });
      } else {
        await endCall(sid);
      }
    } else if (answeredBy.startsWith("machine_end")) {
      setStatus(line, "voicemail");
      log(`Line ${line.index + 1}: ${who} voicemail (${answeredBy}) → dropping message`);
      await client().calls(sid).update({ twiml: wrap(voicemailTwiml()) });
    } else {
      // fax or anything unexpected
      setStatus(line, "ended");
      log(`Line ${line.index + 1}: ${who} answered by ${answeredBy}, hanging up`);
      await endCall(sid);
    }
  } catch (e) {
    log(`Line ${line.index + 1}: AMD handling error: ${(e as Error).message}`);
  }
  return new Response(null, { status: 204 });
}
