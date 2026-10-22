import { describe, expect, it, vi } from "vitest";
import { handle, costUsd, validate, MONTHLY_CAP_USD, type Env } from "../src/assistant";

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

  it("blocks the 11th question, and records spend", async () => {
    const { e, k } = env();
    const create = vi.fn(async () => msg());
    for (let i = 0; i < 10; i++) expect((await handle(req(good), e, create)).status).toBe(200);
    expect((await handle(req(good), e, create)).status).toBe(429);
    expect(create).toHaveBeenCalledTimes(10);
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
