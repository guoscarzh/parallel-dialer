import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Lead } from "../types";
import { type LeadSource, toE164 } from "./source";

const BASE = "https://app.scrapercity.com";

export type PlannedSearch = {
  name: string;
  description: string;
  matches: number | null;
  filters: Record<string, string | string[]>;
  cost?: string;
};

function headers(): HeadersInit {
  const key = process.env.SCRAPERCITY_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** Plain English → database filters + live match count. Free; works without a key. */
export async function planSearch(query: string): Promise<{ targeting?: string; searches: PlannedSearch[] }> {
  const url = `${BASE}/api/v1/start?${new URLSearchParams({ query })}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`ScraperCity planner returned ${res.status}`);
  const data = await res.json();
  const req = data.your_request ?? {};
  const searches: PlannedSearch[] = (req.searches ?? [])
    .filter((s: { database?: string }) => s.database === "leads")
    .map((s: Record<string, unknown>) => ({
      name: String(s.name ?? "Search"),
      description: String(s.description ?? ""),
      matches: typeof s.matching_records === "number" ? s.matching_records : null,
      filters: (s.filters ?? {}) as PlannedSearch["filters"],
      cost: (s.cost_on_the_trial ?? s.cost) as string | undefined,
    }));
  return { targeting: req.targeting, searches };
}

// Field names vary; take the first one present.
function pick(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
}

export function normalizeLead(r: Record<string, unknown>, i: number): Lead | null {
  const directPhone = pick(r, "mobile_phone", "mobile", "phone_mobile", "direct_phone", "phone", "phone_number", "work_phone");
  const companyPhone = pick(r, "company_phone", "organization_phone");
  const phone = toE164(directPhone || companyPhone);
  if (!phone) return null;
  const name =
    pick(r, "full_name", "name") || [pick(r, "first_name"), pick(r, "last_name")].filter(Boolean).join(" ");
  const city = pick(r, "city", "person_city");
  const state = pick(r, "state", "person_state");
  const context: Record<string, string> = {
    Industry: pick(r, "company_industry", "industry"),
    "Company size": pick(r, "employees_count", "company_size"),
    "Total funding": pick(r, "company_total_funding"),
    "Annual revenue": pick(r, "company_annual_revenue"),
    Founded: pick(r, "company_founded_year"),
    Website: pick(r, "company_website", "company_domain", "website"),
    Location: [city, state].filter(Boolean).join(", "),
    Seniority: pick(r, "seniority"),
    Keywords: pick(r, "keywords").slice(0, 300),
    "Phone type": directPhone ? "direct" : "company main line",
  };
  return {
    id: `sc-${pick(r, "id", "lead_id") || i}`,
    name: name || "Unknown",
    title: pick(r, "title", "job_title"),
    company: pick(r, "company_name", "company", "organization_name"),
    phone,
    context: Object.fromEntries(Object.entries(context).filter(([, v]) => v)),
  };
}

export const PRICE_PER_LEAD_MICRO = 4900; // $0.0049 per new Lead Database record on the trial
export const MAX_PULL = 25;

/** Read the wallet. Free: no credits used. */
export async function getWallet() {
  const res = await fetch(`${BASE}/api/v1/wallet`, { headers: headers() });
  if (!res.ok) throw new Error(`ScraperCity wallet returned ${res.status}`);
  const d = await res.json();
  return {
    balanceMicro: Number(d.wallet?.total_balance_micro ?? 0),
    usedMicro: Math.max(0, Number(d.plan?.used_micro ?? 0)),
    nextBilling: d.billing?.next_billing_date as string | undefined,
  };
}

/** Spending guardrails. Throws unless a pull is explicitly allowed and stays well inside budget. */
async function assertCanSpend(limit: number) {
  if (process.env.SCRAPERCITY_ALLOW_SPEND !== "true") {
    throw new Error("Lead pulls are locked (SCRAPERCITY_ALLOW_SPEND=false). Nothing was charged.");
  }
  const capMicro = Math.round(Number(process.env.SCRAPERCITY_MAX_SPEND_DOLLARS ?? "1") * 1_000_000);
  const costMicro = limit * PRICE_PER_LEAD_MICRO;
  const w = await getWallet();
  if (w.usedMicro + costMicro > capMicro) {
    throw new Error(
      `Blocked: this pull (~$${(costMicro / 1e6).toFixed(2)}) would push total spend past the $${(capMicro / 1e6).toFixed(2)} cap. Nothing was charged.`,
    );
  }
  if (costMicro > w.balanceMicro - 500_000) {
    throw new Error("Blocked: would leave less than $0.50 of trial credit. Nothing was charged.");
  }
}

/** Pull leads with phones from the Lead Database. Cached on disk so a re-run never spends credits twice. */
export async function pullLeads(filters: PlannedSearch["filters"], limit = MAX_PULL): Promise<{ leads: Lead[]; cached: boolean; total?: number }> {
  if (!process.env.SCRAPERCITY_API_KEY) throw new Error("Add SCRAPERCITY_API_KEY to .env.local to pull leads");
  limit = Math.min(Math.max(1, Math.floor(limit)), MAX_PULL);
  const body = { ...filters, hasPhone: true, page: 1, limit };
  const hash = crypto.createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  const cacheDir = path.join(process.cwd(), "data", "cache");
  const cacheFile = path.join(cacheDir, `leads-${hash}.json`);

  let raw: { data?: Record<string, unknown>[]; pagination?: { total?: number } } | undefined;
  let cached = false;
  try {
    raw = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    cached = true;
  } catch {
    await assertCanSpend(limit); // only a cache miss can cost money
    const res = await fetch(`${BASE}/api/v1/database/leads`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ScraperCity ${res.status}: ${text.slice(0, 200)}`);
    }
    raw = await res.json();
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(raw, null, 1));
  }

  const seen = new Set<string>();
  const leads = (raw?.data ?? [])
    .map((r, i) => normalizeLead(r, i))
    .filter((l): l is Lead => !!l && !seen.has(l.phone) && !!seen.add(l.phone));
  return { leads, cached, total: raw?.pagination?.total };
}

// Used only if LEAD_SOURCE=scrapercity; the list builder fills the queue directly.
export const scraperCitySource: LeadSource = {
  name: "scrapercity",
  async fetchLeads() {
    return [];
  },
};
