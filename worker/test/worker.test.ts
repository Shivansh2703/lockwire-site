import { describe, expect, it, vi } from "vitest";
import { handle, costUsd, validate, MONTHLY_CAP_USD, DAILY_QUESTIONS, type Env } from "../src/assistant";
import { Counter, handleHits, WAITLIST_PER_DAY } from "../src/hits";

const kv = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) };
};
const env = (init?: Record<string, string>) => {
  const k = kv(init);
  return { e: { ANTHROPIC_API_KEY: "test", LIMITS: k } as unknown as Env, k };
};
const req = (b: unknown) => new Request("https://w.example/ask", { method: "POST", headers: { origin: "https://lockwirerobotics.com", "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify(b) });
const good = { robot: "drone", mode: "check", question: "Why NO-GO?" };
const msg = (over = {}) => ({ content: [{ type: "text", text: "Because." }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100 }, ...over }) as never;

describe("worker", () => {
  it("validation rejects bad input", () => {
    expect(validate({ ...good, robot: "toaster" })).toBeTypeOf("string");
    expect(validate({ ...good, mode: "x" })).toBeTypeOf("string");
    expect(validate({ ...good, question: "x".repeat(501) })).toBeTypeOf("string");
    expect(validate({ ...good, history: Array(7).fill({ role: "user", content: "a" }) })).toBeTypeOf("string");
    expect(validate(good)).toMatchObject({ robot: "drone" });
  });

  it("cost arithmetic", () => {
    const c = costUsd({ input_tokens: 1000, cache_creation_input_tokens: 8000, cache_read_input_tokens: 10000, output_tokens: 500 });
    expect(c).toBeCloseTo(0.0001 + 0.001 + 0.0001 + 0.00025, 10);
  });

  it("blocks at the cap without calling the model", async () => {
    const { e } = env({ [`spend:${new Date().toISOString().slice(0, 7)}`]: String(MONTHLY_CAP_USD) });
    const create = vi.fn();
    const r = await handle(req(good), e, create);
    expect(r.status).toBe(429);
    expect((await r.json()) as { message: string }).toEqual({ message: "The assistant is resting until next month." });
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks the question after the daily limit, and records spend", async () => {
    const { e, k } = env();
    const create = vi.fn(async () => msg());
    for (let i = 0; i < DAILY_QUESTIONS; i++) expect((await handle(req(good), e, create)).status).toBe(200);
    expect((await handle(req(good), e, create)).status).toBe(429);
    expect(create).toHaveBeenCalledTimes(DAILY_QUESTIONS);
    expect([...k.m.keys()].some((x) => x.includes("1.2.3.4"))).toBe(false);
    expect(parseFloat(k.m.get(`spend:${new Date().toISOString().slice(0, 7)}`)!)).toBeGreaterThan(0);
  });

  it("handles refusal", async () => {
    const r = await handle(req(good), env().e, async () => msg({ stop_reason: "refusal", content: [] }));
    expect(await r.json()).toEqual({ answer: "I can't help with that one." });
  });

  it("rejects other origins", async () => {
    const r = new Request("https://w.example/ask", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify(good) });
    expect((await handle(r, env().e, vi.fn())).status).toBe(403);
  });
});

describe("hit counts", () => {
  // In-memory stand-in for the Durable Object's SQLite table.
  const hitEnv = (token?: string) => {
    const rows = new Map<string, number>();
    const sql = {
      exec: (q: string, ...b: string[]) => {
        if (q.startsWith("INSERT")) rows.set(`${b[0]}|${b[1]}`, (rows.get(`${b[0]}|${b[1]}`) ?? 0) + 1);
        return { toArray: () => [...rows].map(([k, n]) => ({ day: k.split("|")[0], e: k.split("|")[1], n })).filter((r) => r.day >= b[0]) };
      },
    };
    const counter = new Counter({ storage: { sql } } as never);
    return { rows, e: { STATS_TOKEN: token, HITS: { idFromName: () => "x", get: () => ({ fetch: (u: string, i?: RequestInit) => counter.fetch(new Request(u, i)) }) } } as unknown as Env };
  };
  const post = (body: string) => new Request("https://w.example/hit", { method: "POST", headers: { origin: "http://127.0.0.1:4329", "content-type": "text/plain" }, body });

  it("rejects unknown events and counts known ones", async () => {
    const { e, rows } = hitEnv();
    expect((await handleHits(post('{"e":"robot_toaster"}'), e))!.status).toBe(400);
    expect((await handleHits(post("not json"), e))!.status).toBe(400);
    for (const ev of ["view", "view", "mode_run", "robot_drone"]) expect((await handleHits(post(JSON.stringify({ e: ev })), e))!.status).toBe(204);
    expect([...rows.values()].sort()).toEqual([1, 1, 2]);
  });

  it("stats need the token", async () => {
    const { e } = hitEnv("s3cret");
    await handleHits(post('{"e":"view"}'), e);
    const get = (auth?: string) => handleHits(new Request("https://w.example/stats", { headers: auth ? { authorization: auth } : {} }), e);
    expect((await get())!.status).toBe(401);
    expect((await get("Bearer nope"))!.status).toBe(401);
    const ok = await get("Bearer s3cret");
    expect(Object.values((await ok!.json()) as Record<string, Record<string, number>>)[0]).toEqual({ view: 1 });
    expect((await handleHits(new Request("https://w.example/stats"), hitEnv().e))!.status).toBe(401); // no token configured
  });

  it("waitlist stores each email once, rate-limits, and lists only with the token", async () => {
    const list = new Map<string, string[]>();
    const sql = { exec: (q: string, ...b: string[]) => {
      if (q.startsWith("INSERT INTO waitlist") && !list.has(b[0])) list.set(b[0], b);
      return { toArray: () => [...list.values()].map(([email, robot, day]) => ({ email, robot, day })) };
    } };
    const counter = new Counter({ storage: { sql } } as never);
    const k = kv();
    const e = { STATS_TOKEN: "s3cret", LIMITS: k, HITS: { idFromName: () => "x", get: () => ({ fetch: (u: string, i?: RequestInit) => counter.fetch(new Request(u, i)) }) } } as unknown as Env;
    const join = (b: unknown) => handleHits(new Request("https://w.example/waitlist", { method: "POST", headers: { origin: "https://lockwirerobotics.com", "cf-connecting-ip": "1.2.3.4", "content-type": "text/plain" }, body: JSON.stringify(b) }), e);
    expect((await join({ email: "not-an-email" }))!.status).toBe(400);
    expect((await join({ email: "A@Lab.io", robot: "hexapod" }))!.status).toBe(200);
    expect((await join({ email: "a@lab.io" }))!.status).toBe(200);
    expect([...list.keys()]).toEqual(["a@lab.io"]);
    for (let i = 2; i < WAITLIST_PER_DAY; i++) await join({ email: `x${i}@lab.io` });
    expect((await join({ email: "late@lab.io" }))!.status).toBe(429);
    expect([...k.m.keys()].some((x) => x.includes("1.2.3.4"))).toBe(false);
    const get = (auth?: string) => handleHits(new Request("https://w.example/waitlist", { headers: auth ? { authorization: auth } : {} }), e);
    expect((await get())!.status).toBe(401);
    expect(((await (await get("Bearer s3cret"))!.json()) as { email: string }[])[0]).toEqual({ email: "a@lab.io", robot: "hexapod", day: expect.any(String) });
  });
});
