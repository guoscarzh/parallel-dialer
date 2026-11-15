import type { Brief, Lead, Line, LineStatus } from "@/lib/types";
import type { DialerState } from "./dialer";

// Fake data for /?preview — lets you see the UI move without placing real calls.
const LEADS: Lead[] = [
  { id: "m1", name: "Priya Raman", company: "Northwind Logistics", title: "VP of Sales", phone: "+14155550142" },
  { id: "m2", name: "Marcus Chen", company: "Brightline Health", title: "Head of Revenue Ops", phone: "+16465550199" },
  { id: "m3", name: "Elena Torres", company: "Kestrel Analytics", title: "Director of Growth", phone: "+13125550117" },
  { id: "m4", name: "Jordan Blake", company: "Summit Fintech", title: "CRO", phone: "+12125550173" },
  { id: "m5", name: "Aisha Okafor", company: "Lumen Robotics", title: "VP Business Development", phone: "+17375550108" },
  { id: "m6", name: "Daniel Kim", company: "Parcel Labs", title: "Sales Director", phone: "+12065550164" },
  { id: "m7", name: "Sofia Rossi", company: "Gridwise Energy", title: "Head of Partnerships", phone: "+15125550131" },
  { id: "m8", name: "Ben Adler", company: "Copperleaf AI", title: "VP Sales, North America", phone: "+19175550186" },
];

let T0 = 0;

const BRIEFS: Brief[] = [
  {
    summary: "Priya runs a 40-rep sales org at Northwind, a mid-market freight logistics platform.",
    painPoints: ["Reps lose hours to unanswered dials", "Inconsistent voicemail quality across the team"],
    opener: "Hi Priya, it's Oscar. I'll be quick, it's about how your reps spend their dialing hours.",
    question: "How many dials does a rep make before they get one real conversation?",
  },
  {
    summary: "Marcus owns the revenue tooling stack at Brightline Health, a Series B digital health company.",
    painPoints: ["Low connect rates on outbound to clinic decision-makers", "SDR ramp time and burnout"],
    opener: "Hey Marcus, Oscar here. You own the rev stack at Brightline, so you're exactly who I wanted to reach.",
    question: "What does your team's connect rate look like on cold calls right now?",
  },
  {
    summary: "Elena leads growth at Kestrel Analytics, a B2B analytics startup scaling outbound.",
    painPoints: ["Outbound volume capped by headcount", "Hard to measure call ROI"],
    opener: "Hi Elena, Oscar here. Saw Kestrel is leaning into outbound, so I had to call.",
    question: "Is outbound volume limited by headcount or by tooling today?",
  },
];
const READY = (i: number) => ({ status: "ready" as const, brief: BRIEFS[i], source: "prewritten" as const });

export function mockState(now: number): DialerState {
  T0 ||= now;
  const t = ((now - T0) / 1000) % 30; // 30s loop
  const cycleStart = now - t * 1000;
  const at = (s: number) => cycleStart + s * 1000;

  const timeline: [number, LineStatus][][] = [
    [[0, "dialing"], [2, "ringing"], [7, "detecting"], [11, "voicemail"]],
    [[0, "dialing"], [2.5, "ringing"], [6, "detecting"], [8, "connected"]],
    [[0, "dialing"], [3, "ringing"], [8, "dropped"]],
  ];

  const lines: Line[] = timeline.map((steps, i) => {
    let status: LineStatus = "dialing";
    let changedAt = at(0);
    for (const [s, st] of steps) if (t >= s) { status = st; changedAt = at(s); }
    return {
      index: i,
      status,
      lead: LEADS[i],
      callSid: `CA-mock-${i}`,
      startedAt: at(0),
      connectedAt: status === "connected" ? at(8) : undefined,
      updatedAt: changedAt,
    };
  });

  const log = [
    ...(t >= 11 ? [{ at: at(11), msg: "Line 1: Priya Raman voicemail (machine_end_beep) → dropping message" }] : []),
    ...(t >= 8 ? [{ at: at(8), msg: "Line 2: Marcus Chen is human → connecting to SDR" }] : []),
    ...(t >= 4 ? [{ at: at(4), msg: "AI brief ready for Marcus Chen (3.8s)" }] : []),
    { at: at(0), msg: "Line 3: dialing Elena Torres (+13125550117)" },
    { at: at(0), msg: "Line 2: dialing Marcus Chen (+16465550199)" },
    { at: at(0), msg: "Line 1: dialing Priya Raman (+14155550142)" },
  ];

  return {
    lines,
    winnerSid: t >= 8 ? "CA-mock-1" : null,
    queue: LEADS.slice(3),
    queueRemaining: 47,
    queueLoaded: true,
    leadSource: "scrapercity",
    stats: { dials: 36, connects: 7, voicemails: 14, noAnswers: 12, meetings: 3, lineMs: 58 * 60_000, wallMs: 27 * 60_000 },
    sessionStartedAt: T0 - 42 * 60 * 1000,
    batchStartedAt: t < 11 ? at(0) : null,
    history: [
      { at: T0 - 300000, lead: LEADS[5], disposition: "meeting", notes: "Demo Thursday 2pm. Evaluating Orum, wants pricing." },
      { at: T0 - 600000, lead: LEADS[6], disposition: "callback", notes: "Call back after Q4 planning." },
      { at: T0 - 900000, lead: LEADS[7], disposition: "not-interested", notes: "" },
    ],
    briefs: {
      m1: t >= 5 ? READY(0) : { status: "pending" },
      m2: t >= 4 ? READY(1) : { status: "pending" },
      m3: t >= 6 ? READY(2) : { status: "pending" },
    },
    simulate: false,
    web: false,
    publicUrl: null,
    sdrName: "Oscar",
    log,
    serverNow: now,
  };
}
