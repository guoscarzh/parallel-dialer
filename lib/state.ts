import type { Line, LineStatus, Session } from "./types";

export const LINE_COUNT = 3;

// In-memory state. Fine for a single local process (MVP); swap for Redis/DB later.
const g = globalThis as unknown as { __dialerSession?: Session };

function freshLines(): Line[] {
  return Array.from({ length: LINE_COUNT }, (_, index) => ({
    index,
    status: "idle" as LineStatus,
    updatedAt: Date.now(),
  }));
}

export function freshStats() {
  return { dials: 0, connects: 0, voicemails: 0, noAnswers: 0, meetings: 0, lineMs: 0, wallMs: 0 };
}

export function session(): Session {
  const prev = g.__dialerSession;
  if (!prev || !prev.stats || !prev.history || prev.stats.lineMs === undefined || !prev.briefs || prev.simulate === undefined || prev.web === undefined) {
    // Fresh process, or state left over from an older code version during dev hot reload.
    g.__dialerSession = {
      lines: freshLines(),
      winnerSid: null,
      queue: [],
      queueLoaded: false,
      leadSource: "",
      log: [],
      stats: freshStats(),
      sessionStartedAt: null,
      batchStartedAt: null,
      history: [],
      briefs: {},
      // CALL_MODE=live|web|sim picks the startup mode (SIMULATE_CALLS=true is the older spelling of sim).
      simulate: process.env.CALL_MODE === "sim" || (!process.env.CALL_MODE && process.env.SIMULATE_CALLS === "true"),
      web: process.env.CALL_MODE === "web",
      webPhones: [],
    };
  }
  return g.__dialerSession!;
}

export function log(msg: string) {
  const s = session();
  s.log.unshift({ at: Date.now(), msg });
  s.log.length = Math.min(s.log.length, 100);
  console.log(`[dialer] ${msg}`);
}

export function lineBySid(callSid: string): Line | undefined {
  return session().lines.find((l) => l.callSid === callSid);
}

export function setStatus(line: Line, status: LineStatus) {
  if (line.status === status) return;
  const now = Date.now();
  const st = session().stats;
  if (status === "dialing") {
    line.startedAt = now;
    st.dials++;
  }
  if (status === "connected") {
    line.connectedAt = now;
    st.connects++;
  }
  if (status === "voicemail") st.voicemails++;
  if (status === "no-answer" || status === "busy") st.noAnswers++;
  line.status = status;
  line.updatedAt = now;
}

export function resetLines() {
  session().lines = freshLines();
  session().winnerSid = null;
}

/** A line's call is over (any reason). Accumulates time-saved stats once per line. */
export function markEnded(line: Line) {
  if (line.endedAt || !line.startedAt) return;
  const s = session();
  const now = Date.now();
  line.endedAt = now;
  s.stats.lineMs += now - line.startedAt;
  const batchDone = s.lines.every((l) => !l.lead || l.endedAt);
  if (batchDone && s.batchStartedAt) {
    s.stats.wallMs += now - s.batchStartedAt;
    s.batchStartedAt = null;
  }
}
