import { planSearch } from "@/lib/leads/scrapercity";

/** Turn a plain-English ICP into lead-database filters with a live match count. */
export async function POST(req: Request) {
  const { query } = (await req.json().catch(() => ({}))) as { query?: string };
  if (!query?.trim()) return Response.json({ error: "Describe who you want to call" }, { status: 400 });
  try {
    return Response.json(await planSearch(query.trim()));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
