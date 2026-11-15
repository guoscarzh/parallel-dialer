import { csvSource } from "@/lib/leads/csv";
import { type PlannedSearch, pullLeads } from "@/lib/leads/scrapercity";
import { log, session } from "@/lib/state";

/** Pull leads for a planned search into the dial queue. */
export async function POST(req: Request) {
  const { filters, name, limit, keepTestLeads } = (await req.json().catch(() => ({}))) as {
    filters?: PlannedSearch["filters"];
    name?: string;
    limit?: number;
    keepTestLeads?: boolean;
  };
  if (!filters) return Response.json({ error: "Missing filters" }, { status: 400 });
  try {
    const { leads, cached, total } = await pullLeads(filters, limit ?? 25);
    // On a Twilio trial only verified numbers can be called, so test leads can stay at the front.
    const testLeads = keepTestLeads ? await csvSource.fetchLeads().catch(() => []) : [];
    const s = session();
    s.queue = [...testLeads, ...leads];
    s.queueLoaded = true;
    s.leadSource = "scrapercity";
    log(`Pulled ${leads.length} leads with phones for "${name ?? "search"}"${cached ? " (cached, no credits used)" : ""}`);
    return Response.json({ ok: true, pulled: leads.length, cached, total, queued: s.queue.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
