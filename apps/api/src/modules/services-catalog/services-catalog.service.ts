import { Inject, Injectable } from "@nestjs/common"
import { asc, eq, inArray } from "drizzle-orm"

import type { CreateServiceCatalogItemBody, PublicServiceCatalogItem, ServiceCatalogItem, UpdateServiceCatalogItemBody } from "@unitravel/contracts"
import { type Db, serviceCatalogItems } from "@unitravel/db"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"

export type CatalogRow = typeof serviceCatalogItems.$inferSelect
type Reader = Pick<Db, "select">
type Ctx = { requestId: string }

export const toStaffItem = (r: CatalogRow): ServiceCatalogItem => ({
  id: r.id, code: r.code, nameEn: r.nameEn, nameFa: r.nameFa, descriptionEn: r.descriptionEn ?? undefined, descriptionFa: r.descriptionFa ?? undefined,
  lineType: r.lineType as ServiceCatalogItem["lineType"], defaultPriceMinor: r.defaultPriceMinor, currency: r.currency, perPassenger: r.perPassenger,
  showPriceToCustomer: r.showPriceToCustomer, active: r.active, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
})

/** Price fields appear only when staff flagged the item; the default price is otherwise staff-only. */
export const toPublicItem = (r: CatalogRow): PublicServiceCatalogItem => ({
  code: r.code, nameEn: r.nameEn, nameFa: r.nameFa, descriptionEn: r.descriptionEn ?? undefined, descriptionFa: r.descriptionFa ?? undefined,
  lineType: r.lineType as PublicServiceCatalogItem["lineType"], perPassenger: r.perPassenger,
  ...(r.showPriceToCustomer ? { priceMinor: r.defaultPriceMinor, currency: r.currency } : {}),
})

/** Add-on service catalogue (STAGE-23 stream C). Codes are immutable; every change is audited. */
@Injectable()
export class ServicesCatalogService {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly audit: AuditService) {}

  async publicList(): Promise<PublicServiceCatalogItem[]> {
    const rows = await this.db.select().from(serviceCatalogItems).where(eq(serviceCatalogItems.active, true)).orderBy(asc(serviceCatalogItems.code))
    return rows.map(toPublicItem)
  }

  async staffList(): Promise<ServiceCatalogItem[]> {
    const rows = await this.db.select().from(serviceCatalogItems).orderBy(asc(serviceCatalogItems.code))
    return rows.map(toStaffItem)
  }

  async activeForQuotes(): Promise<ServiceCatalogItem[]> {
    const rows = await this.db.select().from(serviceCatalogItems).where(eq(serviceCatalogItems.active, true)).orderBy(asc(serviceCatalogItems.code))
    return rows.map(toStaffItem)
  }

  async create(body: CreateServiceCatalogItemBody, actor: Actor, ctx: Ctx): Promise<ServiceCatalogItem> {
    return this.uow.run(async (tx) => {
      const [taken] = await tx.select({ id: serviceCatalogItems.id }).from(serviceCatalogItems).where(eq(serviceCatalogItems.code, body.code))
      if (taken) throw new AppError("VALIDATION_FAILED", "That code is already in use", [{ path: "code", code: "DUPLICATE" }])
      const [row] = await tx.insert(serviceCatalogItems).values({ ...body, createdBy: actor.userId }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "service_catalog.created", entityType: "service_catalog_item", entityId: row!.id, after: { code: row!.code, active: row!.active }, ip: actor.ip, requestId: ctx.requestId })
      return toStaffItem(row!)
    })
  }

  async update(id: string, patch: UpdateServiceCatalogItemBody, actor: Actor, ctx: Ctx): Promise<ServiceCatalogItem> {
    return this.uow.run(async (tx) => {
      const [before] = await tx.select().from(serviceCatalogItems).where(eq(serviceCatalogItems.id, id)).for("update")
      if (!before) throw notFound("Catalogue item")
      const [row] = await tx.update(serviceCatalogItems).set(patch).where(eq(serviceCatalogItems.id, id)).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "service_catalog.updated", entityType: "service_catalog_item", entityId: id, before: toStaffItem(before), after: patch, ip: actor.ip, requestId: ctx.requestId })
      return toStaffItem(row!)
    })
  }

  /** Active items for the given codes; unknown or inactive codes are a validation error (path `serviceInterests`). */
  async resolveActiveCodes(tx: Reader, codes: readonly string[]): Promise<CatalogRow[]> {
    if (codes.length === 0) return []
    const rows = await tx.select().from(serviceCatalogItems).where(inArray(serviceCatalogItems.code, [...codes]))
    const active = rows.filter((r) => r.active)
    const missing = codes.filter((c) => !active.some((r) => r.code === c))
    if (missing.length > 0) throw new AppError("VALIDATION_FAILED", `Unknown or inactive service: ${missing.join(", ")}`, [{ path: "serviceInterests", code: "UNKNOWN_SERVICE" }])
    return active
  }

  /** Quote lines reference items by id; an inactive item cannot be newly attached. */
  async resolveActiveIds(tx: Reader, ids: readonly string[]): Promise<Map<string, CatalogRow>> {
    if (ids.length === 0) return new Map()
    const rows = await tx.select().from(serviceCatalogItems).where(inArray(serviceCatalogItems.id, [...ids]))
    const byId = new Map(rows.filter((r) => r.active).map((r) => [r.id, r]))
    if (ids.some((i) => !byId.has(i))) throw new AppError("VALIDATION_FAILED", "Unknown or inactive catalogue item", [{ path: "catalogueItemId", code: "UNKNOWN_SERVICE" }])
    return byId
  }
}
