import twilio from "twilio";
import { env, SDR_IDENTITY } from "@/lib/twilio";


/** Access token for the browser softphone (Twilio Voice JS SDK). */
export async function GET() {
  try {
    const { AccessToken } = twilio.jwt;
    const token = new AccessToken(
      env("TWILIO_ACCOUNT_SID"),
      env("TWILIO_API_KEY_SID"),
      env("TWILIO_API_KEY_SECRET"),
      { identity: SDR_IDENTITY, ttl: 3600 },
    );
    token.addGrant(new AccessToken.VoiceGrant({ incomingAllow: true }));
    return Response.json({ token: token.toJwt(), identity: SDR_IDENTITY });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
