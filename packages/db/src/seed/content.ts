import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { sql } from "drizzle-orm"
import { CmsEntryBody, CmsSlug, CmsStatus, GlossaryTermBody } from "@unitravel/contracts"

import type { Db } from "../index"
import * as s from "../schema"

// ADR-0017: seed content extracted from UniTravel-Content.docx (docs/content/INVENTORY.md). Nothing is seeded as
// PUBLISHED: entries with open claims start IN_REVIEW, the rest DRAFT, and the owner publishes after review.
const SeedStatus = CmsStatus.exclude(["PUBLISHED", "ARCHIVED"])
export const SeedEntry = CmsEntryBody.extend({ status: SeedStatus })
export const SeedGlossaryTerm = GlossaryTermBody.extend({ slug: CmsSlug, status: SeedStatus })

const dir = resolve(__dirname, "../../seed-content")
const load = (file: string): unknown => JSON.parse(readFileSync(resolve(dir, file), "utf8"))

export function readSeedContent() {
  const entries = SeedEntry.array().parse(load("entries.json"))
  const glossary = SeedGlossaryTerm.array().parse(load("glossary.json"))
  for (const e of entries) if (e.claimsToVerify.length > 0 && e.status === "DRAFT") throw new Error(`${e.slug}: open claims need IN_REVIEW`)
  return { entries, glossary }
}

/** Inserts missing rows only: a staff edit, or a row staff archived, is never overwritten. Needs an owner to be the author. */
export async function seedContent(db: Db): Promise<{ entries: number; terms: number } | null> {
  const owner = await db.execute(sql`select ur.user_id as id from user_roles ur join roles r on r.id = ur.role_id where r.key = 'owner' order by ur.user_id limit 1`)
  const authorId = (owner.rows[0] as { id: string } | undefined)?.id
  if (!authorId) return null
  const { entries, glossary } = readSeedContent()
  let e = 0
  let t = 0
  for (const row of entries) {
    const { status, publishAt: _publishAt, ...rest } = row
    const res = await db.insert(s.cmsEntries).values({ ...rest, status, authorId }).onConflictDoNothing().returning({ id: s.cmsEntries.id })
    e += res.length
  }
  for (const term of glossary) {
    const res = await db.insert(s.glossaryTerms).values(term).onConflictDoNothing().returning({ id: s.glossaryTerms.id })
    t += res.length
  }
  return { entries: e, terms: t }
}

