import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import { isWriteOnceKey, ObjectStorage, WriteOnceViolation } from "./storage"

/** A store double: keys that exist answer HeadObject; PutObject honours If-None-Match like S3 and RustFS do (412). */
function storage(existing: string[] = []) {
  const keys = new Set(existing)
  const send = vi.fn(async (cmd: unknown) => {
    if (cmd instanceof HeadObjectCommand) {
      if (!keys.has(cmd.input.Key!)) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } })
      return { ContentLength: 1 }
    }
    if (cmd instanceof PutObjectCommand) {
      if (cmd.input.IfNoneMatch === "*" && keys.has(cmd.input.Key!)) throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } })
      keys.add(cmd.input.Key!)
      return {}
    }
    return {}
  })
  const s = Object.create(ObjectStorage.prototype) as ObjectStorage
  Object.assign(s, { client: { send }, bucket: "b", identityBucket: "b-identity" })
  return { s, send, keys }
}

describe("write-once originals (ADR-0038 D2)", () => {
  it("only the tickets/original/ prefix is write-once", () => {
    expect(isWriteOnceKey("tickets/original/2026-11/x.pdf")).toBe(true)
    expect(isWriteOnceKey("2026-11/x.pdf")).toBe(false)
    expect(isWriteOnceKey("x/tickets/original/y.pdf")).toBe(false)
  })

  it("writes a new key once, with If-None-Match: *", async () => {
    const { s, send } = storage()
    await s.put("tickets/original/2026-11/a.pdf", Buffer.from("%PDF-1.7"), "application/pdf")
    const put = send.mock.calls.map((c) => c[0]).find((c) => c instanceof PutObjectCommand) as PutObjectCommand
    expect(put.input.IfNoneMatch).toBe("*")
  })

  it("refuses to overwrite an existing original, through put() and putOnce()", async () => {
    const { s } = storage(["tickets/original/2026-11/a.pdf"])
    await expect(s.put("tickets/original/2026-11/a.pdf", Buffer.from("other"), "application/pdf")).rejects.toBeInstanceOf(WriteOnceViolation)
    await expect(s.putOnce("tickets/original/2026-11/a.pdf", Buffer.from("other"), "application/pdf")).rejects.toBeInstanceOf(WriteOnceViolation)
  })

  it("the store's own 412 is a write-once violation too (a writer raced the existence check)", async () => {
    const { s, keys } = storage()
    const real = s.sizeOf.bind(s)
    // The check sees a free key, then another writer creates it before the PUT.
    vi.spyOn(s, "sizeOf").mockImplementationOnce(async (k) => { const r = await real(k); keys.add(k); return r })
    await expect(s.putOnce("tickets/original/2026-11/b.pdf", Buffer.from("x"), "application/pdf")).rejects.toBeInstanceOf(WriteOnceViolation)
  })

  it("ordinary keys are still overwritable (identity scans are rewritten after metadata stripping)", async () => {
    const { s } = storage(["2026-11/c.png"])
    await expect(s.put("2026-11/c.png", Buffer.from("x"), "image/png")).resolves.toBeUndefined()
  })
})
