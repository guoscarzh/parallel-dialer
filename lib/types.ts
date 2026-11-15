export type Lead = {
  id: string;
  name: string;
  company: string;
  title: string;
  phone: string; // E.164
  /** Extra facts from the lead source (industry, size, funding, website, location…) for the AI brief. */
  context?: Record<string, string>;
};

export type Brief = {
  summary: string;
  painPoints: string[];
  opener: string;
  question: string;
};

export type BriefState = {
  status: "pending" | "ready" | "error";
  brief?: Brief;
  error?: string;
  /** "claude" when generated live; "prewritten" for the hand-written fallback in lib/briefs.ts. */
  source?: "claude" | "prewritten";
};

export type LineStatus =
  | "idle"
  | "dialing"
  | "ringing"
  | "detecting" // answered, AMD deciding human vs machine
  | "connected" // human, bridged to SDR
  | "voicemail" // machine, voicemail being dropped / dropped
  | "dropped" // hung up because another line won
  | "no-answer"
  | "busy"
  | "failed"
  | "ended";

export type Line = {
  index: number;
  status: LineStatus;
  lead?: Lead;
  callSid?: string;
  answeredBy?: string;
  updatedAt: number;
  startedAt?: number;
  connectedAt?: number;
  endedAt?: number;
};

export type Disposition = "meeting" | "interested" | "callback" | "not-interested" | "wrong-number";

export type Stats = {
  dials: number;
  connects: number;
  voicemails: number;
  noAnswers: number;
  meetings: number;
  lineMs: number; // total time spent across every line (what single-line dialing would cost)
  wallMs: number; // actual wall-clock time those batches took
};

export type CallRecord = {
  at: number;
  lead: Lead;
  disposition: Disposition;
  notes: string;
};

export type Session = {
  lines: Line[];
  winnerSid: string | null;
  queue: Lead[];
  queueLoaded: boolean;
  leadSource: string;
  log: { at: number; msg: string }[];
  stats: Stats;
  sessionStartedAt: number | null;
  batchStartedAt: number | null;
  history: CallRecord[];
  briefs: Record<string, BriefState>;
  /** Simulated calls: the phone network is simulated, everything else is real. */
  simulate: boolean;
  /** Web phone mode: leads are phones that opened /phone; calls are WebRTC, not the phone network. */
  web: boolean;
  webPhones: WebPhone[];
};

export type WebPhone = { peerId: string; name: string; company: string; title: string; lastSeen: number };

export const ACTIVE_STATUSES: LineStatus[] = ["dialing", "ringing", "detecting", "connected"];
