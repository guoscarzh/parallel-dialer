import { log, session } from "@/lib/state";

/** A phone opened /phone and is ready to be dialed. Called every few seconds as a heartbeat. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { peerId?: string; name?: string; company?: string; title?: string };
  if (!b.peerId || !/^pd-lead-[a-z0-9]{6,}$/.test(b.peerId)) return Response.json({ error: "bad peerId" }, { status: 400 });
  const clean = (v: unknown, max = 60) => String(v ?? "").trim().slice(0, max);
  const s = session();
  const existing = s.webPhones.find((p) => p.peerId === b.peerId);
  const data = {
    peerId: b.peerId,
    name: clean(b.name) || "Guest",
    company: clean(b.company),
    title: clean(b.title),
    lastSeen: Date.now(),
  };
  if (existing) Object.assign(existing, data);
  else {
    s.webPhones.push(data);
    s.webPhones = s.webPhones.slice(-20);
    log(`Web phone joined: ${data.name}${data.company ? ` (${data.company})` : ""}`);
  }
  return Response.json({ ok: true });
}
