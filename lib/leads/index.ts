import { log, session } from "../state";
import { ACTIVE_STATUSES, type Lead } from "../types";
import { csvSource } from "./csv";
import { scraperCitySource } from "./scrapercity";
import type { LeadSource } from "./source";

export function getLeadSource(): LeadSource {
  return process.env.LEAD_SOURCE === "scrapercity" ? scraperCitySource : csvSource;
}

/** Load the lead queue from the configured source once per process. */
export const WEB_PHONE_TTL_MS = 25_000;

/** Web phones that checked in recently and aren't already on a line. */
export function webPhoneLeads(): Lead[] {
  const s = session();
  const busy = new Set(s.lines.filter((l) => l.lead && ACTIVE_STATUSES.includes(l.status)).map((l) => l.lead!.id));
  return s.webPhones
    .filter((p) => Date.now() - p.lastSeen < WEB_PHONE_TTL_MS)
    .map((p) => ({
      id: `web-${p.peerId}`,
      name: p.name,
      company: p.company,
      title: p.title,
      phone: "Web phone",
      context: { Note: "Joined from a phone during a live demo" },
    }))
    .filter((l) => !busy.has(l.id));
}

export async function ensureQueue() {
  const s = session();
  if (s.web) {
    s.queue = webPhoneLeads();
    s.queueLoaded = true;
    s.leadSource = "web";
    return;
  }
  if (s.queueLoaded) return;
  const source = getLeadSource();
  s.queue = await source.fetchLeads();
  s.queueLoaded = true;
  s.leadSource = source.name;
  log(`Loaded ${s.queue.length} leads from ${source.name}`);
}
