import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { prewrittenBrief } from "./briefs";
import { log, session } from "./state";
import type { Lead } from "./types";

const BriefSchema = z.object({
  summary: z.string().describe("Who this person is and what their company does, one sentence"),
  painPoints: z.array(z.string()).describe("Two likely pain points relevant to what we sell, short phrases"),
  opener: z.string().describe("A natural first line to say after they pick up, one sentence"),
  question: z.string().describe("One sharp discovery question, one sentence"),
});

let client: Anthropic | undefined;

const SYSTEM = `You prep a sales development rep (SDR) for a cold call that is connecting right now.
They will glance at your brief for two seconds while saying hello, so every field is one short, spoken-style sentence.
Be specific to this person, their role and their company. Use only the facts provided plus general knowledge of the role and industry; never invent company news, numbers or names. When the facts are thin, frame points as things to confirm.`;

function leadFacts(lead: Lead) {
  const lines = [
    `Name: ${lead.name}`,
    `Title: ${lead.title || "unknown"}`,
    `Company: ${lead.company || "unknown"}`,
    ...Object.entries(lead.context ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`),
  ];
  return lines.join("\n");
}

async function generate(lead: Lead) {
  client ??= new Anthropic();
  const selling =
    process.env.SDR_PITCH ||
    "A parallel dialer that lets SDRs call three prospects at once, connects whoever picks up instantly, and drops a personal voicemail on the rest.";

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: betaZodOutputFormat(BriefSchema) },
    // Server-side fallback: if the model declines, the API reruns the request on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Caller (the SDR): ${process.env.SDR_NAME || "the rep"}\nWhat we sell: ${selling}\n\nLead:\n${leadFacts(lead)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Model declined to write this brief");
  if (!response.parsed_output) throw new Error(`No brief returned (stop: ${response.stop_reason})`);
  return response.parsed_output;
}

/** Start generating a brief in the background (once per lead). Results land in session().briefs. */
export function startBrief(lead: Lead) {
  const briefs = session().briefs;
  if (briefs[lead.id] && briefs[lead.id].status !== "error") return;
  if (!process.env.ANTHROPIC_API_KEY) {
    // No API key yet: fall back to a hand-written brief, clearly labelled as such in the UI.
    const brief = prewrittenBrief(lead);
    briefs[lead.id] = brief
      ? { status: "ready", brief, source: "prewritten" }
      : { status: "error", error: "No brief for this lead yet. Live AI briefs turn on with an ANTHROPIC_API_KEY." };
    return;
  }
  briefs[lead.id] = { status: "pending" };
  const t0 = Date.now();
  generate(lead)
    .then((brief) => {
      session().briefs[lead.id] = { status: "ready", brief, source: "claude" };
      log(`AI brief ready for ${lead.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    })
    .catch((e: unknown) => {
      const msg = e instanceof Anthropic.APIError ? `Claude API ${e.status}: ${e.message}` : (e as Error).message;
      session().briefs[lead.id] = { status: "error", error: msg };
      log(`AI brief failed for ${lead.name}: ${msg}`);
    });
}
