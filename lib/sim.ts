import { startBrief } from "./ai";
import { claimHuman } from "./routing";
import { log, markEnded, session, setStatus } from "./state";
import { ACTIVE_STATUSES, type Line } from "./types";

// Simulated phone network for demos: same state machine, stats and UI as live calls, no Twilio.
type Outcome = "human" | "voicemail" | "no-answer";

const g = globalThis as unknown as { __simTimers?: ReturnType<typeof setTimeout>[]; __simBatch?: number };
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function clearSim() {
  (g.__simTimers ?? []).forEach(clearTimeout);
  g.__simTimers = [];
}

function outcomesFor(n: number): Outcome[] {
  const rest: Outcome[] = ["voicemail", "no-answer"];
  if (Math.random() < 0.3) rest.push("human"); // sometimes two people answer: the second one is released
  const shuffled = rest.sort(() => Math.random() - 0.5);
  return (["human", ...shuffled] as Outcome[]).slice(0, n).sort(() => Math.random() - 0.5);
}

export function runSimBatch(lines: Line[]) {
  clearSim();
  const batch = (g.__simBatch = (g.__simBatch ?? 0) + 1);
  const outcomes = outcomesFor(lines.length);

  const at = (ms: number, fn: () => void) => {
    g.__simTimers!.push(
      setTimeout(() => {
        if (g.__simBatch === batch) fn();
      }, ms),
    );
  };
  const active = (l: Line) => ACTIVE_STATUSES.includes(l.status);
  const n = (l: Line) => `Line ${l.index + 1}`;

  lines.forEach((line, i) => {
    const sid = `SIM-${batch}-${i}`;
    line.callSid = sid;
    setStatus(line, "dialing");
    if (line.lead) startBrief(line.lead);
    log(`${n(line)}: dialing ${line.lead?.name} (${line.lead?.phone})`);

    const ring = rand(1200, 2500);
    at(ring, () => line.status === "dialing" && setStatus(line, "ringing"));

    const outcome = outcomes[i];
    if (outcome === "human") {
      const answer = ring + rand(3500, 7000);
      at(answer, () => line.status === "ringing" && setStatus(line, "detecting"));
      at(answer + 1800, async () => {
        if (line.status !== "detecting") return;
        if (await claimHuman(line, sid)) {
          // Lines released by the winner are over.
          session().lines.filter((l) => l.status === "dropped").forEach(markEnded);
        } else {
          markEnded(line);
        }
      });
    } else if (outcome === "voicemail") {
      const answer = ring + rand(6000, 10000);
      at(answer, () => line.status === "ringing" && setStatus(line, "detecting"));
      at(answer + 2500, () => {
        if (line.status !== "detecting") return;
        setStatus(line, "voicemail");
        log(`${n(line)}: ${line.lead?.name} voicemail (machine_end_beep) → dropping message`);
      });
      at(answer + 2500 + 14000, () => line.status === "voicemail" && markEnded(line));
    } else {
      at(ring + rand(15000, 19000), () => {
        if (!active(line) || line.status === "connected") return;
        setStatus(line, "no-answer");
        log(`${n(line)}: no-answer`);
        markEnded(line);
      });
    }
  });
}
