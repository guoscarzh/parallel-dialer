import { startBrief } from "@/lib/ai";
import { ensureQueue } from "@/lib/leads";
import { LINE_COUNT, log, resetLines, session, setStatus } from "@/lib/state";
import { amdEnabled } from "@/lib/routing";
import { runSimBatch } from "@/lib/sim";
import { client, env, publicUrl } from "@/lib/twilio";
import { ACTIVE_STATUSES } from "@/lib/types";

/** Dial the next batch of leads, one per line. */
export async function POST() {
  const s = session();
  if (s.web) return dialWeb();
  if (s.simulate) return dialSimulated();
  const missing = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "PUBLIC_URL"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    return Response.json({ error: `Missing in .env.local: ${missing.join(", ")}` }, { status: 500 });
  }
  if (s.lines.some((l) => ACTIVE_STATUSES.includes(l.status))) {
    return Response.json({ error: "A batch is already in progress" }, { status: 409 });
  }

  try {
    await ensureQueue();
  } catch (e) {
    return Response.json({ error: `Lead source failed: ${(e as Error).message}` }, { status: 500 });
  }

  const batch = s.queue.splice(0, LINE_COUNT);
  if (batch.length === 0) return Response.json({ error: "Lead queue is empty" }, { status: 400 });

  resetLines();
  s.sessionStartedAt ??= Date.now();
  s.batchStartedAt = Date.now();
  const from = env("TWILIO_PHONE_NUMBER");

  await Promise.all(
    batch.map(async (lead, i) => {
      const line = session().lines[i];
      line.lead = lead;
      setStatus(line, "dialing");
      startBrief(lead); // research while it rings, so the brief is ready at hello
      try {
        const call = await client().calls.create({
          to: lead.phone,
          from,
          url: publicUrl("/api/twilio/answer"),
          statusCallback: publicUrl("/api/twilio/status"),
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
          ...(amdEnabled()
            ? {
                machineDetection: "DetectMessageEnd", // wait for the beep before dropping voicemail
                asyncAmd: "true", // don't block TwiML while AMD decides
                asyncAmdStatusCallback: publicUrl("/api/twilio/amd"),
                timeout: 25,
              }
            : {}),
        });
        line.callSid = call.sid;
        log(`Line ${i + 1}: dialing ${lead.name} (${lead.phone})`);
      } catch (e) {
        setStatus(line, "failed");
        s.stats.dials--; // never actually placed
        line.startedAt = undefined; // don't count toward time saved
        line.endedAt = Date.now();
        log(`Line ${i + 1}: failed to dial ${lead.name}: ${(e as Error).message}`);
      }
    }),
  );

  return Response.json({ ok: true, dialed: batch.length, remaining: s.queue.length });
}

/** Simulated calls: same queue, state machine, stats and AI briefs, with a simulated phone network. */
async function dialSimulated() {
  const s = session();
  if (s.lines.some((l) => ACTIVE_STATUSES.includes(l.status))) {
    return Response.json({ error: "A batch is already in progress" }, { status: 409 });
  }
  try {
    await ensureQueue();
  } catch (e) {
    return Response.json({ error: `Lead source failed: ${(e as Error).message}` }, { status: 500 });
  }
  const batch = s.queue.splice(0, LINE_COUNT);
  if (batch.length === 0) return Response.json({ error: "Lead queue is empty" }, { status: 400 });
  resetLines();
  s.sessionStartedAt ??= Date.now();
  s.batchStartedAt = Date.now();
  const lines = batch.map((lead, i) => Object.assign(session().lines[i], { lead }));
  runSimBatch(lines);
  return Response.json({ ok: true, dialed: batch.length, remaining: s.queue.length, simulated: true });
}

/** Web phone mode: assign web phones to lines; the dashboard places the WebRTC calls and reports events. */
async function dialWeb() {
  const s = session();
  if (s.lines.some((l) => ACTIVE_STATUSES.includes(l.status))) {
    return Response.json({ error: "A batch is already in progress" }, { status: 409 });
  }
  await ensureQueue();
  const batch = s.queue.slice(0, LINE_COUNT);
  if (batch.length === 0) {
    return Response.json({ error: "No web phones connected. Open the phone link on a phone first." }, { status: 400 });
  }
  resetLines();
  s.sessionStartedAt ??= Date.now();
  s.batchStartedAt = Date.now();
  const targets = batch.map((lead, i) => {
    const line = session().lines[i];
    const peerId = lead.id.replace(/^web-/, "");
    line.lead = lead;
    line.callSid = `WEB-${peerId}-${Date.now().toString(36)}`;
    setStatus(line, "dialing");
    startBrief(lead);
    log(`Line ${i + 1}: dialing ${lead.name} (web phone)`);
    return { callSid: line.callSid, peerId };
  });
  return Response.json({ ok: true, dialed: batch.length, web: true, targets });
}
