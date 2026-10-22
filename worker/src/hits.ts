// Privacy-first click counts: one counter per (UTC day, event). No IP, user agent, referrer or id is read or stored.
import type { Env } from "./assistant";

const ROBOTS = ["drone", "arm", "quadruped"];
const MODES = ["design", "declare", "check", "plan", "test", "run", "docs"];
const EVENTS = new Set(["view", "cta_check", "try_free", "ask", "copy_email", ...ROBOTS.map((r) => `robot_${r}`), ...MODES.map((m) => `mode_${m}`)]);
const ALLOWED = /^(https:\/\/(www\.)?lockwirerobotics\.com|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/;

export const isEvent = (e: unknown): e is string => typeof e === "string" && EVENTS.has(e);

const reply = (status: number, body: unknown, origin?: string | null) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin && ALLOWED.test(origin)) { headers["access-control-allow-origin"] = origin; headers["vary"] = "Origin"; }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
};

// Constant-time: compare SHA-256 digests byte by byte without early exit.
async function sameToken(given: string, want: string): Promise<boolean> {
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = [await h(given), await h(want)];
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** The Durable Object: one SQLite table of counts. Single instance ("hits"); ponytail: one DO serialises writes, fine for a landing page. */
export class Counter {
  constructor(private state: DurableObjectState) {
    state.storage.sql.exec("CREATE TABLE IF NOT EXISTS hits (day TEXT, e TEXT, n INTEGER, PRIMARY KEY (day, e))");
  }
  async fetch(req: Request): Promise<Response> {
    const sql = this.state.storage.sql;
    if (req.method === "POST") {
      const { day, e } = (await req.json()) as { day: string; e: string };
      sql.exec("INSERT INTO hits (day, e, n) VALUES (?, ?, 1) ON CONFLICT (day, e) DO UPDATE SET n = n + 1", day, e);
      return new Response(null, { status: 204 });
    }
    const since = new URL(req.url).searchParams.get("since") ?? "";
    const out: Record<string, Record<string, number>> = {};
    for (const r of sql.exec("SELECT day, e, n FROM hits WHERE day >= ? ORDER BY day", since).toArray() as { day: string; e: string; n: number }[]) {
      (out[r.day] ??= {})[r.e] = r.n;
    }
    return Response.json(out);
  }
}

/** Handles /hit and /stats; returns null for any other path. */
export async function handleHits(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  const store = () => env.HITS.get(env.HITS.idFromName("hits"));

  if (url.pathname === "/hit" && req.method === "POST") {
    if (origin && !ALLOWED.test(origin)) return reply(403, { message: "Not allowed from this site." });
    const text = await req.text();
    let e: unknown;
    try { e = text.length < 200 ? JSON.parse(text)?.e : undefined; } catch { /* rejected below */ }
    if (!isEvent(e)) return reply(400, { message: "Unknown event." }, origin);
    await store().fetch("https://do/", { method: "POST", body: JSON.stringify({ day: new Date().toISOString().slice(0, 10), e }) });
    return reply(204, null, origin);
  }

  if (url.pathname === "/stats" && req.method === "GET") {
    const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!env.STATS_TOKEN || !(await sameToken(given, env.STATS_TOKEN))) return reply(401, { message: "Unauthorized." });
    const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30));
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    return store().fetch(`https://do/?since=${since}`);
  }
  return null;
}
