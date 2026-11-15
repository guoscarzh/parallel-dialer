import fs from "node:fs";
import path from "node:path";
import twilio from "twilio";
import { lineBySid } from "./state";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

let _client: ReturnType<typeof twilio> | undefined;
export function client() {
  _client ??= twilio(env("TWILIO_ACCOUNT_SID"), env("TWILIO_AUTH_TOKEN"));
  return _client;
}

export const publicUrl = (p: string) => `${env("PUBLIC_URL").replace(/\/$/, "")}${p}`;

/** Parse a Twilio webhook body and verify its signature. Returns null if invalid. */
export async function readWebhook(req: Request): Promise<Record<string, string> | null> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));

  if (process.env.TWILIO_VALIDATE_WEBHOOKS === "false") return params;
  const u = new URL(req.url);
  const url = publicUrl(u.pathname + u.search);
  const sig = req.headers.get("x-twilio-signature") ?? "";
  // Trial accounts route the answer webhook through Twilio's trial proxy, which drops the signature.
  // Accept an unsigned request only in trial mode and only for a call this app placed in the current batch.
  if (!sig && process.env.TWILIO_AMD === "false" && params.CallSid && lineBySid(params.CallSid)) return params;
  const ok = twilio.validateRequest(env("TWILIO_AUTH_TOKEN"), sig, url, params);
  if (!ok) console.warn(`[dialer] invalid Twilio signature for ${url}`);
  return ok ? params : null;
}

export function twiml(xml: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${xml}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

export const forbidden = () => new Response("invalid signature", { status: 403 });

export function voicemailTwiml(): string {
  const mp3 = path.join(process.cwd(), "public", "voicemail.mp3");
  if (fs.existsSync(mp3)) return `<Play>${publicUrl("/voicemail.mp3")}</Play><Hangup/>`;
  return `<Say voice="Polly.Matthew">Hey, this is a placeholder voicemail from the parallel dialer. Sorry I missed you, I'll try again soon.</Say><Hangup/>`;
}

/** End a call regardless of whether it's still ringing or already answered. */
export async function endCall(callSid: string) {
  if (callSid.startsWith("SIM-") || callSid.startsWith("WEB-")) return; // not a Twilio call
  try {
    const call = await client().calls(callSid).fetch();
    if (call.status === "queued" || call.status === "ringing") {
      await client().calls(callSid).update({ status: "canceled" });
    } else if (call.status === "in-progress") {
      await client().calls(callSid).update({ status: "completed" });
    }
  } catch (e) {
    console.warn(`[dialer] could not end ${callSid}:`, (e as Error).message);
  }
}

export const SDR_IDENTITY = "sdr";
