import { Logger } from "@nestjs/common"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApifyCredentialBootstrap } from "./credential-bootstrap"

const TOKEN = "SYNTHETIC-not-an-apify-token-0000wxyz"

function harness(opts: { stored?: { invalidAt: Date | null } | null; provider?: boolean } = {}) {
  const imported: Record<string, string>[] = []
  const audits: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  const published: string[] = []
  const suppliers = {
    row: async () => (opts.provider === false ? undefined : { id: "apify-google-flights" }),
    credentialMeta: async () => opts.stored ?? null,
    importCredentials: async (_id: string, v: Record<string, string>) => { imported.push(v); return true },
    reload: async () => undefined,
  }
  const tx = { update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void updates.push(v) }) }) }
  const uow = { run: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) }
  const audit = { record: async (_t: unknown, e: Record<string, unknown>) => void audits.push(e) }
  const outbox = { add: async () => undefined }
  const redis = { publish: async (ch: string) => void published.push(ch) }
  const svc = new ApifyCredentialBootstrap("api", redis as never, uow as never, suppliers as never, audit as never, outbox as never)
  return { svc, imported, audits, updates, published }
}

describe("APIFY_TOKEN bootstrap (ADR-0032 B1)", () => {
  afterEach(() => vi.restoreAllMocks())

  it("imports the token when none is stored, enables the provider and audits the last 4 characters only", async () => {
    const h = harness()
    expect(await h.svc.importFromEnv(TOKEN)).toBe("IMPORTED")
    expect(h.imported).toEqual([{ token: TOKEN }])
    expect(h.updates[0]).toMatchObject({ enabled: true })
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ actorKind: "SYSTEM", action: "provider.credential.imported_from_env", entityId: "apify-google-flights", after: { last4: "wxyz" } })
    expect(JSON.stringify(h.audits)).not.toContain(TOKEN)
    expect(h.published).toEqual(["provider.config_changed"])
  })

  it.each([{ invalidAt: null }, { invalidAt: new Date() }])("does nothing when a credential is already stored (%o)", async (stored) => {
    const h = harness({ stored })
    expect(await h.svc.importFromEnv(TOKEN)).toBe("ALREADY_STORED")
    expect(h.imported).toEqual([])
    expect(h.audits).toEqual([])
    expect(h.updates).toEqual([])
  })

  it("does nothing without a token or without the provider row", async () => {
    expect(await harness().svc.importFromEnv(undefined)).toBe("NO_TOKEN")
    expect(await harness({ provider: false }).svc.importFromEnv(TOKEN)).toBe("NO_PROVIDER")
  })

  it("never logs the value", async () => {
    const lines: string[] = []
    for (const level of ["log", "warn", "error", "debug", "verbose"] as const) vi.spyOn(Logger.prototype, level).mockImplementation((...a: unknown[]) => void lines.push(JSON.stringify(a)))
    const h = harness()
    await h.svc.importFromEnv(TOKEN)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join("\n")).not.toContain(TOKEN)
    expect(lines.join("\n")).not.toContain(TOKEN.slice(0, -4))
  })

  it("runs on the API process only", async () => {
    const h = harness()
    const worker = new ApifyCredentialBootstrap("worker", {} as never, {} as never, { row: () => { throw new Error("must not run") } } as never, {} as never, {} as never)
    await worker.onApplicationBootstrap()
    expect(h.imported).toEqual([])
  })
})
