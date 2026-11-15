import type { Brief, Lead } from "./types";

// Hand-written call briefs, used while no AI key is configured (see lib/ai.ts).
// Written from the facts on each lead's record only, pitching the parallel dialer.

const BY_NAME: Record<string, Brief> = {
  oscar: {
    summary:
      "Oscar is a Sales Development Representative at Nickco and a DECA ICDC finalist: competitive, comfortable on the phone, and measured on meetings booked.",
    painPoints: [
      "Most of the day goes to dial tones, voicemail and no-answers instead of real conversations",
      "Meeting quota depends on a handful of live connects per day",
    ],
    opener: "Hey Oscar, saw you're running outbound at Nickco, and as a DECA ICDC finalist you'll appreciate me keeping this pitch tight.",
    question: "Out of a hundred dials right now, how many turn into an actual conversation?",
  },
  "priya raman": {
    summary: "Priya runs sales at Northwind Logistics, a 220-person freight and logistics software company in San Francisco.",
    painPoints: ["Reps spend hours dialing shippers who rarely pick up", "Hard to scale pipeline without adding headcount"],
    opener: "Hi Priya, I work with sales teams selling into logistics, and I'll be quick.",
    question: "How many live conversations does each of your reps get on a typical calling day?",
  },
  "marcus chen": {
    summary: "Marcus owns revenue operations at Brightline Health, a Series B digital health company of about 140 people in New York.",
    painPoints: ["Low connect rates when calling busy clinical buyers", "Rep activity data scattered across tools"],
    opener: "Hey Marcus, you own the rev stack at Brightline, so you're exactly who I wanted to reach.",
    question: "What does your team's connect rate look like on cold calls right now?",
  },
  "elena torres": {
    summary: "Elena leads growth at Kestrel Analytics, an 85-person B2B analytics SaaS company in Chicago.",
    painPoints: ["Outbound has to grow without a big SDR team", "Slow follow-up on inbound and trial signups"],
    opener: "Hi Elena, quick one: I help lean growth teams get more conversations out of the same calling hours.",
    question: "Is outbound calling part of your growth motion today, or mostly email?",
  },
  "jordan blake": {
    summary: "Jordan is CRO at Summit Fintech, a 310-person payments infrastructure company in New York.",
    painPoints: ["Ramp time for new SDRs is long", "Finance buyers are hard to reach live"],
    opener: "Hi Jordan, I'll keep this short. It's about getting your SDRs in front of more payments buyers per hour.",
    question: "How are you measuring SDR productivity today, dials or conversations?",
  },
  "aisha okafor": {
    summary: "Aisha leads business development at Lumen Robotics, a 190-person warehouse robotics company in Austin.",
    painPoints: ["Ops and warehouse buyers are rarely at a desk", "Long sales cycles need lots of first conversations"],
    opener: "Hey Aisha, I know warehouse folks are hard to catch at a desk, which is exactly why I'm calling.",
    question: "When your team calls operations leaders, how often does someone actually pick up?",
  },
  "daniel kim": {
    summary: "Daniel is Sales Director at Parcel Labs, a 60-person e-commerce shipping software company in Seattle.",
    painPoints: ["Small team covering a large list of merchants", "Reps burn time on voicemails"],
    opener: "Hi Daniel, I help small sales teams cover a lot more merchants without hiring.",
    question: "How many merchants can one of your reps realistically reach in a day?",
  },
  "sofia rossi": {
    summary: "Sofia heads partnerships at Gridwise Energy, a 120-person grid analytics company in Austin.",
    painPoints: ["Utility and channel contacts are hard to reach", "Partner outreach competes with deal work for time"],
    opener: "Hi Sofia, I'll be quick. I've got an idea for getting more partner conversations out of less calling time.",
    question: "Does your partnerships team do its own outbound calling today?",
  },
  "ben adler": {
    summary: "Ben runs North American sales at Copperleaf AI, a 250-person AI company for asset management in New York.",
    painPoints: ["Enterprise buyers screen most cold calls", "Reps juggle research and dialing"],
    opener: "Hi Ben, I work with AI sales teams on one thing: more live conversations per hour.",
    question: "How much of your reps' day goes to dialing versus actually talking?",
  },
  "hannah park": {
    summary: "Hannah directs sales development at Tidewater Security, a 400-person cloud security company in Boston.",
    painPoints: ["SDR team hitting activity targets but not conversation targets", "Security buyers rarely answer unknown numbers"],
    opener: "Hi Hannah, since you run the SDR team at Tidewater, this one's right up your alley.",
    question: "What connect rate is your SDR team seeing on security buyers this quarter?",
  },
  "luis herrera": {
    summary: "Luis is Head of Sales at Orbit Payroll, a 75-person HR and payroll SaaS company in Miami.",
    painPoints: ["SMB owners are busy and hard to reach", "Small team needs more conversations per rep"],
    opener: "Hey Luis, I know business owners are tough to catch live, which is why I'm calling.",
    question: "How do your reps decide who to call first each morning?",
  },
  "grace liu": {
    summary: "Grace leads growth at Fernway Learning, a 45-person Series A edtech company in San Jose.",
    painPoints: ["School and district buyers keep limited hours", "Early team has to prove a repeatable outbound motion"],
    opener: "Hi Grace, quick call. I help early teams prove outbound works without a big SDR hire.",
    question: "Are you calling schools directly today, or relying on inbound?",
  },
  "omar haddad": {
    summary: "Omar leads enterprise sales at Stackline Data, a 160-person data infrastructure company in Portland.",
    painPoints: ["Technical buyers screen calls", "Enterprise deals need many first touches across an account"],
    opener: "Hi Omar, I'll keep it short. It's about reaching more people inside your target accounts.",
    question: "How many contacts per account does your team usually call before someone engages?",
  },
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** A prewritten brief for this lead, matched by full name (or first name "Oscar"). */
export function prewrittenBrief(lead: Lead): Brief | undefined {
  const name = norm(lead.name);
  return BY_NAME[name] ?? (name.split(" ")[0] === "oscar" ? BY_NAME.oscar : undefined);
}
