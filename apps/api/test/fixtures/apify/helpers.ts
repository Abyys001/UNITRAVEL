import type { ReferenceLookup } from "@unitravel/engine"

/** In-memory stand-in for the ioredis commands the Apify code uses. Expiry is not simulated. */
export class FakeRedis {
  readonly kv = new Map<string, string>()
  readonly sets = new Map<string, Set<string>>()
  readonly published: [string, string][] = []
  async get(k: string) { return this.kv.get(k) ?? null }
  async set(k: string, v: string, ...args: (string | number)[]) {
    if (args.includes("NX") && this.kv.has(k)) return null
    this.kv.set(k, v)
    return "OK"
  }
  async del(...keys: string[]) { let n = 0; for (const k of keys) { if (this.kv.delete(k)) n++; if (this.sets.delete(k)) n++ } return n }
  async exists(k: string) { return this.kv.has(k) || this.sets.has(k) ? 1 : 0 }
  async expire() { return 1 }
  async incr(k: string) { const n = Number(this.kv.get(k) ?? 0) + 1; this.kv.set(k, String(n)); return n }
  async decr(k: string) { const n = Number(this.kv.get(k) ?? 0) - 1; this.kv.set(k, String(n)); return n }
  async incrby(k: string, by: number) { const n = Number(this.kv.get(k) ?? 0) + by; this.kv.set(k, String(n)); return n }
  async incrbyfloat(k: string, by: number) { const n = Number(this.kv.get(k) ?? 0) + by; this.kv.set(k, String(n)); return String(n) }
  async sadd(k: string, ...m: string[]) { const s = this.sets.get(k) ?? new Set(); let n = 0; for (const x of m) if (!s.has(x)) { s.add(x); n++ } this.sets.set(k, s); return n }
  async smembers(k: string) { return [...(this.sets.get(k) ?? [])] }
  async scard(k: string) { return this.sets.get(k)?.size ?? 0 }
  async sismember(k: string, m: string) { return this.sets.get(k)?.has(m) ? 1 : 0 }
  async publish(ch: string, msg: string) { this.published.push([ch, msg]); return 1 }
  async hgetall() { return {} }
  async zrange() { return [] }
  async lrange() { return [] }
  /** Enough of a pipeline for the circuit-breaker bookkeeping: every command is accepted and ignored. */
  multi() { const chain: Record<string, unknown> = new Proxy({}, { get: (_t, p) => (p === "exec" ? async () => [] : () => chain) }); return chain as never }
  keys(prefix: string) { return [...this.kv.keys()].filter((k) => k.startsWith(prefix)) }
}

const AIRPORTS: Record<string, { country: string; tz: string; cityCode: string | null; regions: string[] }> = {
  IKA: { country: "IR", tz: "Asia/Tehran", cityCode: "THR", regions: ["IR"] }, THR: { country: "IR", tz: "Asia/Tehran", cityCode: "THR", regions: ["IR"] },
  VAN: { country: "TR", tz: "Europe/Istanbul", cityCode: null, regions: ["TR"] }, IST: { country: "TR", tz: "Europe/Istanbul", cityCode: "IST", regions: ["TR"] },
  LHR: { country: "GB", tz: "Europe/London", cityCode: "LON", regions: ["GB", "UK", "EUROPE"] },
}
/** Reference data with the airports the fixtures use; ZZZ is deliberately unknown. */
export const reference: ReferenceLookup = {
  airport: (iata) => (AIRPORTS[iata] ? { iata, nameEn: iata, nameFa: iata, ...AIRPORTS[iata]! } : undefined),
  cityAirports: (c) => Object.entries(AIRPORTS).filter(([, a]) => a.cityCode === c).map(([i]) => i),
}
