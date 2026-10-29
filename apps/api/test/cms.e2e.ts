import { beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

/** ADR-0017 content system: drafts are invisible, claims block publishing, only the owner publishes, slug changes redirect. */
const anon = new Session("WEB")
let admin: Session, owner: Session, customer: Session
const tag = Math.random().toString(36).slice(2, 8)
const body = (slug: string, extra: Record<string, unknown> = {}) => ({
  kind: "ARTICLE", locale: "en", slug, title: `Test ${slug}`, summary: "s", bodyMd: "## Heading\n\nText", tags: ["e2e"], relatedServices: ["flights"], claimsToVerify: [], ...extra,
})

beforeAll(async () => {
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  owner = await staffSession(STAFF.owner, ADMIN_HOST)
  customer = new Session("WEB")
  await signIn(customer, randomPhone("+4477009"), { givenNamesLatin: "Cms", surnameLatin: "Customer" })
})

describe("Content system (ADR-0017)", () => {
  let id: string
  let version: number
  const slug = `e2e-${tag}`

  it("customers and anonymous callers cannot reach the staff routes", async () => {
    expect((await customer.get("/v1/admin/cms/entries")).status).toBe(403)
    expect((await customer.post("/v1/admin/cms/entries", body(slug))).status).toBe(403)
    expect((await anon.get("/v1/admin/cms/entries")).status).toBe(401)
  })

  it("an admin creates a draft; it is invisible publicly", async () => {
    const r = await admin.post("/v1/admin/cms/entries", body(slug, { claimsToVerify: ["Support is available 24/7"] }))
    expect(r.status).toBe(201)
    expect(r.body.status).toBe("DRAFT")
    id = r.body.id
    version = r.body.version
    expect((await anon.get(`/v1/cms/entries/ARTICLE/${slug}?locale=en`)).status).toBe(404)
    const list = await anon.get(`/v1/cms/entries?kind=ARTICLE&locale=en&tag=e2e`)
    expect(list.body.items.find((i: any) => i.slug === slug)).toBeUndefined()
  })

  it("raw HTML in the body is refused", async () => {
    const r = await admin.post("/v1/admin/cms/entries", body(`${slug}-html`, { bodyMd: "hi <script>alert(1)</script>" }))
    expect(r.status).toBe(400)
  })

  it("an admin can send to review but cannot publish", async () => {
    const review = await admin.post(`/v1/admin/cms/entries/${id}/transition`, { to: "IN_REVIEW", version })
    expect(review.status).toBe(200)
    version = review.body.version
    expect((await admin.post(`/v1/admin/cms/entries/${id}/transition`, { to: "PUBLISHED", version })).status).toBe(403)
  })

  it("the owner cannot publish while a claim is unverified", async () => {
    const r = await owner.post(`/v1/admin/cms/entries/${id}/transition`, { to: "PUBLISHED", version })
    expect(r.status).toBe(409)
    expect(JSON.stringify(r.body)).toContain("UNVERIFIED_CLAIM")
  })

  it("a stale version is a conflict", async () => {
    expect((await admin.patch(`/v1/admin/cms/entries/${id}`, { title: "Stale", version: version - 1 })).status).toBe(409)
  })

  it("editing sends an in-review entry back to draft; once the claim is cleared the owner publishes and it goes live", async () => {
    const edit = await admin.patch(`/v1/admin/cms/entries/${id}`, { claimsToVerify: [], version })
    expect(edit.status).toBe(200)
    expect(edit.body.status).toBe("DRAFT")
    version = edit.body.version
    const review = await admin.post(`/v1/admin/cms/entries/${id}/transition`, { to: "IN_REVIEW", version })
    version = review.body.version
    const pub = await owner.post(`/v1/admin/cms/entries/${id}/transition`, { to: "PUBLISHED", version })
    expect(pub.status).toBe(200)
    expect(pub.body.status).toBe("PUBLISHED")
    version = pub.body.version
    const live = await anon.get(`/v1/cms/entries/ARTICLE/${slug}?locale=en`)
    expect(live.status).toBe(200)
    expect(live.body.bodyMd).toContain("Heading")
    expect(live.headers.get("cache-control")).toContain("max-age=60")
    expect((await anon.get(`/v1/cms/sitemap`)).body.entries.some((e: any) => e.slug === slug)).toBe(true)
  })

  it("a slug change keeps the old address as a redirect, and revisions are kept", async () => {
    const edit = await owner.patch(`/v1/admin/cms/entries/${id}`, { slug: `${slug}-new`, version })
    expect(edit.status).toBe(200)
    version = edit.body.version
    expect((await anon.get(`/v1/cms/resolve/ARTICLE/${slug}?locale=en`)).status).toBe(404) // target is a draft again
    const review = await owner.post(`/v1/admin/cms/entries/${id}/transition`, { to: "IN_REVIEW", version })
    const pub = await owner.post(`/v1/admin/cms/entries/${id}/transition`, { to: "PUBLISHED", version: review.body.version })
    expect(pub.status).toBe(200)
    const res = await anon.get(`/v1/cms/resolve/ARTICLE/${slug}?locale=en`)
    expect(res.status).toBe(200)
    expect(res.body.redirectTo).toBe(`${slug}-new`)
    const revs = await admin.get(`/v1/admin/cms/entries/${id}/revisions`)
    expect(revs.status).toBe(200)
    expect(revs.body.length).toBeGreaterThanOrEqual(5)
  })

  it("a scheduled entry is not public until its time", async () => {
    const s = `${slug}-later`
    const c = await owner.post("/v1/admin/cms/entries", body(s, { publishAt: new Date(Date.now() + 86400_000).toISOString() }))
    const r1 = await owner.post(`/v1/admin/cms/entries/${c.body.id}/transition`, { to: "IN_REVIEW", version: c.body.version })
    const r2 = await owner.post(`/v1/admin/cms/entries/${c.body.id}/transition`, { to: "PUBLISHED", version: r1.body.version })
    expect(r2.status).toBe(200)
    expect((await anon.get(`/v1/cms/entries/ARTICLE/${s}?locale=en`)).status).toBe(404)
  })

  it("glossary: draft is hidden; the owner publishes; admin cannot", async () => {
    const t = await admin.post("/v1/admin/cms/glossary", { termFa: "تست", termEn: `E2E Term ${tag}`, explanationFa: "توضیح", category: "FLIGHT" })
    expect(t.status).toBe(201)
    expect((await anon.get(`/v1/cms/glossary?q=${encodeURIComponent(`E2E Term ${tag}`)}`)).body).toEqual([])
    expect((await admin.post(`/v1/admin/cms/glossary/${t.body.slug}/transition`, { to: "PUBLISHED" })).status).toBe(403) // permission is checked before the move
    expect((await admin.post(`/v1/admin/cms/glossary/${t.body.slug}/transition`, { to: "IN_REVIEW" })).status).toBe(200)
    expect((await admin.post(`/v1/admin/cms/glossary/${t.body.slug}/transition`, { to: "PUBLISHED" })).status).toBe(403)
    expect((await owner.post(`/v1/admin/cms/glossary/${t.body.slug}/transition`, { to: "PUBLISHED" })).status).toBe(200)
    expect((await anon.get(`/v1/cms/glossary?q=${encodeURIComponent(`E2E Term ${tag}`)}`)).body).toHaveLength(1)
  })
})
