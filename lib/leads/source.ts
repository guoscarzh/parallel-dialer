import type { Lead } from "../types";

export interface LeadSource {
  name: string;
  fetchLeads(): Promise<Lead[]>;
}

/** Normalize to E.164, assuming US if no country code. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length >= 11) return digits;
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}
