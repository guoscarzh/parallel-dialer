import fs from "node:fs/promises";
import path from "node:path";
import { session } from "../state";
import type { Lead } from "../types";
import { type LeadSource, toE164 } from "./source";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export const csvSource: LeadSource = {
  name: "csv",
  async fetchLeads() {
    const dir = path.join(process.cwd(), "data");
    // Simulated calls use a fictional demo list; live calls use your own (verified) numbers.
    const primary = session().simulate ? "demo-leads.csv" : "leads.csv";
    const file = await fs.readFile(path.join(dir, primary), "utf8").catch(() =>
      fs.readFile(path.join(dir, "leads.example.csv"), "utf8"),
    );
    const [header, ...rows] = parseCsv(file);
    const col = (n: string) => header.findIndex((h) => h.trim().toLowerCase() === n);
    const idx = { name: col("name"), company: col("company"), title: col("title"), phone: col("phone") };
    const leads: Lead[] = [];
    rows.forEach((r, i) => {
      const phone = toE164(r[idx.phone] ?? "");
      if (!phone) return;
      const context: Record<string, string> = {};
      header.forEach((h, j) => {
        const key = h.trim();
        if (!["name", "company", "title", "phone"].includes(key.toLowerCase()) && r[j]?.trim()) context[key] = r[j].trim();
      });
      leads.push({
        id: `csv-${i}`,
        context,
        name: r[idx.name]?.trim() ?? "",
        company: r[idx.company]?.trim() ?? "",
        title: r[idx.title]?.trim() ?? "",
        phone,
      });
    });
    return leads;
  },
};
